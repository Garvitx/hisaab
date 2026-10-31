// One detection pass over a changed merchant: rules + optional hunter -> verified findings -> case -> default actions.
import { db } from "@/lib/db";
import { trace } from "@/agent/trace";
import type { FindingOrigin, Verdict } from "@/generated/prisma/client";
import * as billing from "@/systems/billing";
import * as disputes from "@/systems/disputes";
import * as lending from "@/systems/lending";
import * as logistics from "@/systems/logistics";
import * as merchants from "@/systems/merchants";
import * as settlement from "@/systems/settlement";
import { reconcile } from "./reconcile";
import { verify, type Check, type Refs } from "./verifiers";
import { proposeAction } from "./actions";

const DAY = 86_400_000;

// pickup_never_completed proposes nothing: the concierge asks the merchant first (confirmMerchantClaim).
export const DEFAULT_ACTIONS: Record<Check, string[]> = {
  charge_after_return: ["reverse_charge", "close_subscription"],
  charge_without_delivery: ["reverse_charge", "close_subscription"],
  silent_deduction: ["send_warning"],
  orphan_dispute: ["contest_dispute"],
  zombie_loan: ["close_loan"],
  duplicate_deduction: ["reverse_deduction"],
  deduction_without_source: ["reverse_deduction"],
  pickup_never_completed: [],
  payment_velocity: ["alert_merchant"],
  payments_stopped: ["alert_merchant"],
};

export type Hypothesis = { title: string; check: string; refs: unknown; why: string };

// Key order and id order must not make the same finding look new.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Refs)[k])]))
  : v;
const key = (check: string, refs: unknown) => `${check}:${JSON.stringify(canon(refs ?? {}))}`;

export async function detectMerchant(
  merchant_id: string,
  opts: {
    firstEventAt: Date;
    events: { schema: string; table: string; row_id: string; op: string }[];
    hunt?: (snapshot: unknown, events: unknown[]) => Promise<Hypothesis[]>;
  },
): Promise<{ case_id: string | null; findings: number }> {
  type F = { origin: FindingOrigin; check: string; title: string; amount: number; refs: Refs; verified: boolean; verdict: Verdict };
  // Rules and the hunter start together: the hunter is the slow half, so this keeps detect_ms near the LLM's latency.
  const [rules, hyps] = await Promise.all([
    reconcile(merchant_id),
    opts.hunt
      ? snapshot(merchant_id).then((s) => opts.hunt!(s, opts.events)).catch((e) => {
          console.error("[detect] hunter failed", (e as Error)?.message || e);
          return [] as Hypothesis[];
        })
      : Promise.resolve([] as Hypothesis[]),
  ]);
  const found: F[] = rules.map((r) => ({ origin: "RULE", check: r.check, title: r.title, amount: r.amount, refs: r.refs, verified: true, verdict: r.verdict }));

  const hypotheses: (Hypothesis & { verified: boolean })[] = [];
  for (const h of hyps) {
    const r = await verify(h.check, h.refs, { merchant_id });
    hypotheses.push({ ...h, verified: r.ok });
    found.push(r.ok
      ? { origin: "HUNTER", check: h.check, title: r.title, amount: r.amount, refs: r.refs, verified: true, verdict: r.verdict }
      : { origin: "HUNTER", check: h.check, title: h.title, amount: 0, refs: (h.refs ?? {}) as Refs, verified: false, verdict: r.verdict });
  }

  // The hunter often re-finds what a rule already caught, pointing at it differently (device vs
  // subscription), so the refs-based dedupe below misses it and the same rupees get proposed twice.
  // A hunter finding whose check a rule already reported (this pass or in the last day) is dropped.
  const ruleChecks = new Set([
    ...found.filter((f) => f.origin === "RULE").map((f) => f.check),
    ...(await db.finding.findMany({ where: { origin: "RULE", verified: true, case: { merchant_id, opened_at: { gte: new Date(Date.now() - DAY) } } }, select: { check: true } })).map((f) => f.check),
  ]);
  for (let i = found.length - 1; i >= 0; i--) if (found[i].origin === "HUNTER" && ruleChecks.has(found[i].check)) found.splice(i, 1);

  const seen = new Set((await db.finding.findMany({ where: { case: { merchant_id } }, select: { check: true, evidence_refs: true } })).map((f) => key(f.check, f.evidence_refs)));
  const fresh = found.filter((f) => {
    const k = key(f.check, f.refs);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  // A case needs at least one verified finding. Hunter guesses the verifier rejected are traced (no case),
  // so decoys stay unflagged and the dashboard can still show "hunter suggested X, engine said no".
  if (!fresh.some((f) => f.verified)) {
    if (fresh.length) await trace({ kind: "DETECT", name: "hunter.rejected", payload: { merchant_id, hypotheses: fresh.map((f) => ({ check: f.check, title: f.title, refs: f.refs })) } });
    return { case_id: null, findings: 0 };
  }

  const detect_ms = Date.now() - opts.firstEventAt.getTime();
  const c = await db.case.create({ data: { merchant_id, source: "DETECTED", summary: fresh.map((f) => f.title).join("; "), detect_ms } });
  const rows = await db.finding.createManyAndReturn({
    data: fresh.map((f) => ({ case_id: c.id, origin: f.origin, check: f.check, title: f.title, amount: f.amount, evidence_refs: f.refs as object, verified: f.verified, verdict: f.verdict })),
  });
  await trace({
    kind: "DETECT", name: "detect", case_id: c.id, ms: detect_ms,
    payload: { merchant_id, events: opts.events.length, findings: rows.map((r) => ({ id: r.id, origin: r.origin, check: r.check, amount: r.amount, verified: r.verified })), hypotheses },
  });

  if (rows.some((r) => r.verified && r.check === "pickup_never_completed"))
    await db.case.update({ where: { id: c.id }, data: { status: "AWAITING_MERCHANT" } });
  for (const f of rows.filter((r) => r.verified))
    for (const type of DEFAULT_ACTIONS[f.check as Check] ?? []) {
      // One failed action must not block the rest; run() already traced the failure.
      await proposeAction({ case_id: c.id, finding_id: f.id, type, reasoning: `Default for ${f.check}` }).catch((e) => console.error("[detect] action failed", type, (e as Error).message));
    }
  return { case_id: c.id, findings: rows.length };
}

// The hunter's view of one merchant: last 90 days, compact. Never includes hisaab.* (and so never injections).
export async function snapshot(merchant_id: string) {
  const now = Date.now(), since = new Date(now - 90 * DAY), sinceMonth = since.toISOString().slice(0, 7);
  const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
  const [m, devs, subs, sets, deds, ds, loans, credits] = await Promise.all([
    merchants.get(merchant_id), logistics.devices(merchant_id), billing.subscriptions(merchant_id),
    settlement.settlements(merchant_id, since), settlement.deductions(merchant_id, { from: since }),
    disputes.list(merchant_id), lending.loans(merchant_id), settlement.credits(merchant_id),
  ]);
  const setDay = new Map(sets.map((s) => [s.id, day(s.date)]));
  const pays = new Map((await settlement.payments(ds.map((d) => d.payment_id))).map((p) => [p.id, p]));
  return {
    as_of: new Date(now).toISOString(),
    merchant: m && { id: m.id, business_name: m.business_name, segment: m.segment, city: m.city },
    devices: devs.map((d) => ({
      id: d.id, model: d.model, serial: d.serial, last_seen_at: d.last_seen_at.toISOString(), online: logistics.isOnline(d, now),
      events: d.events.map((e) => ({ type: e.type, on: day(e.at) })),
      replacement_requests: d.replacement_requests.map((r) => ({ id: r.id, status: r.status, on: day(r.created_at) })),
    })),
    subscriptions: subs.map((s) => ({
      id: s.id, device_id: s.device_id, plan: s.plan, monthly_rent: s.monthly_rent, status: s.status, started: day(s.started_at), closed: day(s.closed_at),
      charges: s.charges.filter((c) => c.period >= sinceMonth).map((c) => ({
        id: c.id, period: c.period, kind: c.kind, amount: c.amount, status: c.status,
        deducted_on: c.deducted_in_settlement_id ? (setDay.get(c.deducted_in_settlement_id) ?? "before window") : null, notice_sent: day(c.notice_sent_at),
      })),
    })),
    settlements: { columns: ["date", "gross", "deductions_total", "net"], rows: sets.map((s) => [day(s.date), s.gross, s.deductions_total, s.net]) },
    deductions: deds.map((d) => ({ id: d.id, on: day(d.settlement.date), type: d.type, amount: d.amount, source_ref: d.source_ref })),
    disputes: ds.map((d) => {
      const p = pays.get(d.payment_id);
      return {
        id: d.id, amount: d.amount, reason: d.reason, raised_by_vpa: d.raised_by_vpa, status: d.status, merchant_contested: d.merchant_contested,
        deducted_on: day(d.deducted_at), payment: p && { id: p.id, txn_ref: p.txn_ref, order_ref: p.order_ref, payer_vpa: p.payer_vpa, on: day(p.created_at) },
      };
    }),
    loans: loans.map((l) => ({
      id: l.id, principal: l.principal, outstanding: l.outstanding, status: l.status, settlement_offer_amount: l.settlement_offer_amount,
      payments: l.payments.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, on: day(p.at) })),
    })),
    credits: credits.map((c) => ({ amount: c.amount, reason: c.reason, on: day(c.created_at) })),
  };
}
