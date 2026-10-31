// Propose -> policy -> execute / wait for approval / escalate. Amounts come from the finding, never a caller.
import { db } from "@/lib/db";
import { trace, timed } from "@/agent/trace";
import type { Action, CaseStatus, DecidedVia, Finding } from "@/generated/prisma/client";
import { decide, type Kind } from "./policy";
import { executors, runInverse, type ActionType, type Inverse } from "./executors";
import { verify, type Refs } from "./verifiers";

// close_loan has no executor: lending is always a human's call in the lending system.
const TYPES = [...Object.keys(executors), "close_loan"];
const KIND: Record<string, Kind> = { alert_merchant: "notify", send_warning: "notify", book_replacement: "notify", schedule_pickup: "notify", request_pickup: "notify", close_loan: "lending" };
const MONEY = new Set(["reverse_charge", "reverse_deduction", "close_subscription", "contest_dispute", "send_warning", "close_loan"]);

// Higher wins; RESOLVED is lowest so any new pending work reopens the case.
const RANK: Record<CaseStatus, number> = { RESOLVED: 0, OPEN: 1, AWAITING_APPROVAL: 2, AWAITING_MERCHANT: 3, ESCALATED: 4 };

async function raiseCase(case_id: string, status: CaseStatus) {
  const c = await db.case.findUniqueOrThrow({ where: { id: case_id }, select: { status: true } });
  if (RANK[status] > RANK[c.status]) await db.case.update({ where: { id: case_id }, data: { status, resolved_at: null } });
}

async function settle(case_id: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: case_id }, select: { status: true } });
  if (c.status === "AWAITING_MERCHANT" || c.status === "RESOLVED") return;
  if (await db.action.count({ where: { case_id, status: { in: ["PENDING", "PROPOSED"] } } })) return;
  await db.case.update({ where: { id: case_id }, data: { status: "RESOLVED", resolved_at: new Date() } });
  await trace({ kind: "ACTION", name: "case.resolved", case_id });
}

async function run(action: Action, finding: Finding | null, params?: Record<string, unknown>) {
  const exec = executors[action.type as ActionType];
  if (!exec) return null;
  const c = await db.case.findUniqueOrThrow({ where: { id: action.case_id }, select: { merchant_id: true } });
  try {
    const { value, ms } = await timed(() =>
      exec({ action_id: action.id, merchant_id: c.merchant_id, amount: action.amount ?? 0, refs: (finding?.evidence_refs ?? params ?? {}) as Refs, params }),
    );
    return { inverse: value, ms };
  } catch (e) {
    await trace({ kind: "ACTION", name: `${action.type}.failed`, case_id: action.case_id, payload: { action_id: action.id, error: (e as Error).message } });
    throw e;
  }
}

export async function proposeAction(a: { case_id: string; finding_id?: string | null; type: string; reasoning?: string; params?: Record<string, unknown> }) {
  if (!TYPES.includes(a.type)) throw new Error(`unknown action type ${a.type}`);
  const f = a.finding_id ? await db.finding.findUniqueOrThrow({ where: { id: a.finding_id } }) : null;
  if (f && f.case_id !== a.case_id) throw new Error("finding is not on this case");
  if (!f && MONEY.has(a.type)) throw new Error(`${a.type} needs a finding`);

  const amount = f?.amount ?? 0;
  const kind: Kind = f?.check === "zombie_loan" ? "lending" : (KIND[a.type] ?? "money");
  const p = await decide({ kind, amount, verified: f?.verified ?? true, evidence_source: f?.evidence_source ?? "LEDGER" });
  // While pending, `inverse` holds the caller's params so approval can run the same thing later.
  let action = await db.action.create({
    data: { case_id: a.case_id, finding_id: f?.id ?? null, type: a.type, amount, tier: p.tier, status: "PROPOSED", reasoning: a.reasoning ?? null, inverse: a.params ? { params: a.params } as object : undefined },
  });
  await trace({ kind: "POLICY", name: a.type, case_id: a.case_id, payload: { action_id: action.id, tier: p.tier, rule: p.rule, reason: p.reason, amount, auto_limit: p.policy.auto_limit, approval_limit: p.policy.approval_limit } });

  if (p.tier === "AUTO") {
    const r = await run(action, f, a.params);
    action = await db.action.update({ where: { id: action.id }, data: { status: "EXECUTED", inverse: (r?.inverse ?? []) as object } });
    await trace({ kind: "ACTION", name: `${a.type}.executed`, case_id: a.case_id, payload: { action_id: action.id, amount, inverse: r?.inverse }, ms: r?.ms });
    await settle(a.case_id);
    return action;
  }
  action = await db.action.update({ where: { id: action.id }, data: { status: "PENDING" } });
  await raiseCase(a.case_id, p.tier === "ESCALATE" ? "ESCALATED" : "AWAITING_APPROVAL");
  await trace({ kind: "ACTION", name: `${a.type}.${p.tier === "ESCALATE" ? "escalated" : "pending"}`, case_id: a.case_id, payload: { action_id: action.id, amount, tier: p.tier } });
  return action;
}

type Decision = { decided_by?: string | null; via: DecidedVia };

async function pending(id: string) {
  const action = await db.action.findUniqueOrThrow({ where: { id } });
  if (action.status !== "PENDING") throw new Error(`action is ${action.status}, not PENDING`);
  return action;
}

export async function approveAction(id: string, d: Decision) {
  const action = await pending(id);
  const f = action.finding_id ? await db.finding.findUnique({ where: { id: action.finding_id } }) : null;
  const params = (action.inverse as { params?: Record<string, unknown> } | null)?.params;
  const r = await run(action, f, params);
  const out = await db.action.update({
    where: { id }, data: { status: "APPROVED", inverse: (r?.inverse ?? []) as object, decided_by: d.decided_by ?? null, decided_via: d.via },
  });
  await trace({ kind: "ACTION", name: `${action.type}.approved`, case_id: action.case_id, payload: { action_id: id, amount: action.amount, decided_by: d.decided_by, via: d.via, executed: !!r }, ms: r?.ms });
  await settle(action.case_id);
  return out;
}

export async function rejectAction(id: string, d: Decision) {
  const action = await pending(id);
  const out = await db.action.update({ where: { id }, data: { status: "REJECTED", inverse: [], decided_by: d.decided_by ?? null, decided_via: d.via } });
  await trace({ kind: "ACTION", name: `${action.type}.rejected`, case_id: action.case_id, payload: { action_id: id, decided_by: d.decided_by, via: d.via } });
  await settle(action.case_id);
  return out;
}

export async function undoAction(id: string, d: Decision) {
  const action = await db.action.findUniqueOrThrow({ where: { id } });
  if (action.status !== "EXECUTED" && action.status !== "APPROVED") throw new Error(`action is ${action.status}, nothing to undo`);
  const inverse = (Array.isArray(action.inverse) ? action.inverse : []) as Inverse;
  const { ms } = await timed(() => runInverse(inverse));
  const out = await db.action.update({ where: { id }, data: { status: "UNDONE", decided_by: d.decided_by ?? null, decided_via: d.via } });
  await trace({ kind: "ACTION", name: `${action.type}.undone`, case_id: action.case_id, payload: { action_id: id, amount: action.amount, decided_by: d.decided_by, via: d.via, steps: inverse.length }, ms });
  return out;
}

// pickup_never_completed: the merchant said "yes, the courier took it". Their word becomes the evidence,
// so policy rule 3 sends the refund to approval. The amount is re-verified from the ledger now.
export async function confirmMerchantClaim(finding_id: string) {
  const f = await db.finding.findUniqueOrThrow({ where: { id: finding_id }, include: { case: { select: { merchant_id: true } } } });
  if (f.check !== "pickup_never_completed") throw new Error("only pickup_never_completed waits on the merchant");
  const r = await verify(f.check, f.evidence_refs, { merchant_id: f.case.merchant_id });
  if (!r.ok) throw new Error(`no longer holds: ${r.title}`);
  const claim = await db.finding.create({
    data: { case_id: f.case_id, origin: f.origin, check: f.check, title: `Merchant confirms the device was picked up; ${r.title}`, amount: r.amount, evidence_refs: r.refs as object, evidence_source: "MERCHANT_CLAIM", verified: true, verdict: "WRONG" },
  });
  await db.case.update({ where: { id: f.case_id }, data: { status: "OPEN" } });
  await trace({ kind: "TOOL_RESULT", name: "merchant_claim", case_id: f.case_id, payload: { finding_id: claim.id, amount: claim.amount } });
  const actions = [];
  for (const type of ["reverse_charge", "close_subscription"]) actions.push(await proposeAction({ case_id: f.case_id, finding_id: claim.id, type, reasoning: "Merchant confirmed the pickup" }));
  return { finding: claim, actions };
}
