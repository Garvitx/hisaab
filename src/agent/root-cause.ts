// Root causes: one systemic bug behind many merchants' findings. The grouping is deterministic
// (the engine picks the shared value, counts merchants and sums finding amounts); the hunter model
// only writes the narrative and picks a guard from three fixed templates, created DISABLED so a
// human turns it on from /ops.
import { db } from "@/lib/db";
import type { RootCause } from "@/generated/prisma/client";
import { sendText } from "@/channels/whatsapp";
import * as billing from "@/systems/billing";
import * as logistics from "@/systems/logistics";
import { TEMPLATES, type Template } from "@/systems/guards";
import { MODEL, json } from "./llm";
import { trace } from "./trace";
import { COURIERS } from "@/inject/lib";

const DAY = 86_400_000;
const MIN_MERCHANTS = 3;
// Groups form on a warehouse or an agent, most specific first; a finding joins only the first group
// that reaches MIN_MERCHANTS. Plan and date window only qualify a group (kept in the signature when
// every member shares them): on their own they are shared by nearly every rent finding of the day,
// so "plan: Soundbox" would flag ordinary demo traffic as a systemic bug.
const ATTRS = ["location", "actor", "window", "plan"] as const;
const GROUP_BY = ["location", "actor"] as const;
type Attr = (typeof ATTRS)[number];
const WAREHOUSE_EVENTS = ["RECEIVED_AT_WAREHOUSE", "PICKED_UP", "DISPATCHED"] as const;

type Row = { merchant_id: string; check: string; amount: number; opened_at: Date; on: string | null; attrs: Partial<Record<Attr, string>> };
type Group = { check: string; attr: (typeof GROUP_BY)[number]; value: string; rows: Row[] };

// The device-side facts a finding's evidence points at. Deduction-only findings have no device and
// so no attributes. ponytail: they never group; add settlement-date windows if that bug class shows up.
async function attrsOf(refs: Record<string, unknown>) {
  const sub = typeof refs.subscription_id === "string" ? await billing.subscription(refs.subscription_id) : null;
  const device_id = typeof refs.device_id === "string" ? refs.device_id : sub?.device_id;
  const device = device_id ? await logistics.device(device_id) : null;
  const plan = sub?.plan ?? (device_id ? (await billing.subscriptionForDevice(device_id))?.plan : undefined);
  // The warehouse step the bug hangs off: the return scan, else the pickup, else the dispatch.
  const ev = WAREHOUSE_EVENTS.map((t) => device?.events.findLast((e) => e.type === t)).find(Boolean);
  const attrs: Partial<Record<Attr, string>> = {
    location: ev?.location ?? undefined,
    // Only identities (field agents, couriers) group; free text like "Paytm warehouse, Okhla" or "hisaab" never does.
    actor: ev && (/^FA-\d+$/.test(ev.actor) || COURIERS.includes(ev.actor)) ? ev.actor : undefined,
    window: ev?.at.toISOString().slice(0, 7),
    plan,
  };
  return { attrs, on: ev?.at.toISOString().slice(0, 10) ?? null };
}

export async function groupFindings(since = new Date(Date.now() - DAY)): Promise<Group[]> {
  const findings = await db.finding.findMany({
    where: { verified: true, amount: { gt: 0 }, case: { opened_at: { gte: since } } },
    select: { check: true, amount: true, evidence_refs: true, case: { select: { merchant_id: true, opened_at: true } } },
  });
  const rows: Row[] = await Promise.all(findings.map(async (f) => ({
    merchant_id: f.case.merchant_id, check: f.check, amount: f.amount, opened_at: f.case.opened_at,
    ...(await attrsOf((f.evidence_refs ?? {}) as Record<string, unknown>)),
  })));
  const groups: Group[] = [];
  for (const check of new Set(rows.map((r) => r.check))) {
    const free = new Set(rows.filter((r) => r.check === check));
    for (const attr of GROUP_BY) {
      const by = new Map<string, Row[]>();
      for (const r of free) if (r.attrs[attr]) by.set(r.attrs[attr]!, [...(by.get(r.attrs[attr]!) ?? []), r]);
      for (const [value, rs] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
        if (new Set(rs.map((r) => r.merchant_id)).size < MIN_MERCHANTS) continue;
        rs.forEach((r) => free.delete(r));
        groups.push({ check, attr, value, rows: rs });
      }
    }
  }
  return groups;
}

// The value every member of the group has, if they all agree.
const shared = (g: Group, a: Attr) => {
  const v = new Set(g.rows.map((r) => r.attrs[a]));
  return v.size === 1 ? [...v][0] : undefined;
};

const totals = (g: Group) => {
  const per = new Map<string, number>();
  for (const r of g.rows) per.set(r.merchant_id, (per.get(r.merchant_id) ?? 0) + r.amount);
  return { merchants: [...per.keys()].sort(), per, total: [...per.values()].reduce((a, b) => a + b, 0) };
};

const rs = (n: number) => `Rs ${n.toLocaleString("en-IN")}`;

// Built by the engine, never the model: the ticket's money figures must match the ledger.
function evidenceTable(g: Group, per: Map<string, number>) {
  const first = new Map<string, Row>();
  for (const r of g.rows) if (!first.has(r.merchant_id)) first.set(r.merchant_id, r);
  const lines = ["| Merchant | Amount | Location | Warehouse event on | Plan |", "| --- | ---: | --- | --- | --- |"];
  for (const [mid, amount] of [...per].sort(([a], [b]) => a.localeCompare(b))) {
    const r = first.get(mid)!;
    lines.push(`| ${mid} | ${rs(amount)} | ${r.attrs.location ?? "-"} | ${r.on ?? "-"} | ${r.attrs.plan ?? "-"} |`);
  }
  return lines.join("\n");
}

const SYSTEM = `You are Hisaab's root-cause analyst at Paytm. The engine has already proved, merchant by merchant, that money was taken wrongly, and grouped those findings because they share one attribute. Explain the systemic bug to engineers.
Write:
- summary: exactly 2 plain sentences for an ops dashboard: what is going wrong and how many merchants and rupees it hit. Use only the numbers given.
- ticket_md: an engineering ticket in GitHub markdown with, in order: "# <title>", "## Impact", "## Evidence" followed by the literal line {{evidence_table}} (the engine inserts the table there; do not write your own table), "## Suspected cause", "## Suggested fix". Keep it under 250 words. Never invent merchant ids, amounts or dates.
- guard: the one guard template that would stop new wrong charges while the bug is fixed:
  pause_rent_after_warehouse_receipt (rent and fees stop for a device once the given warehouse location has scanned it in; set location),
  block_duplicate_deduction (a charge already deducted once cannot be deducted again; location ""),
  block_charge_without_delivery (no rent for a device that was never delivered; location "").
  why: one sentence.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ticket_md: { type: "string" },
    guard: {
      type: "object",
      properties: { template: { type: "string", enum: [...TEMPLATES] }, location: { type: "string" }, why: { type: "string" } },
      required: ["template", "location", "why"],
      additionalProperties: false,
    },
  },
  required: ["summary", "ticket_md", "guard"],
  additionalProperties: false,
};
type Narrative = { summary: string; ticket_md: string; guard: { template: Template; location: string; why: string } };

async function narrate(rc: RootCause, g: Group, per: Map<string, number>) {
  const out = await json<Narrative>({
    model: MODEL.hunt(),
    system: SYSTEM,
    user: JSON.stringify({
      check: g.check, shared: { [g.attr]: g.value }, signature: rc.signature,
      merchants: rc.affected_merchants, total_wrongly_charged_inr: rc.total_amount, first_seen: rc.first_seen.toISOString(),
      findings: g.rows.map((r) => ({ merchant_id: r.merchant_id, amount_inr: r.amount, warehouse_event_on: r.on, ...r.attrs })),
    }),
    schema: SCHEMA,
    meta: { role: "ROOT_CAUSE" },
  });
  const table = evidenceTable(g, per);
  const ticket_md = out.ticket_md.includes("{{evidence_table}}") ? out.ticket_md.replace("{{evidence_table}}", table) : `${out.ticket_md.trim()}\n\n## Evidence\n\n${table}\n`;
  return { ...out, ticket_md };
}

// The guard's params come from the signature, not the model: a location the engine never saw
// would block the wrong warehouse (or none).
function guardParams(g: Group, n: Narrative) {
  if (n.guard.template !== "pause_rent_after_warehouse_receipt") return {};
  const location = g.attr === "location" ? g.value : shared(g, "location");
  return location ? { location } : null;
}

// One pass: every group either creates a root cause, grows one (new merchants joined), or is skipped.
export async function findRootCauses() {
  const out: { id: string; created: boolean; merchants: number; total: number }[] = [];
  for (const g of await groupFindings()) {
    const { merchants, per, total } = totals(g);
    const since = g.rows.map((r) => r.on).filter(Boolean).sort()[0] ?? null;
    const existing = await db.rootCause.findFirst({
      where: { check: g.check, status: { not: "CLOSED" }, signature: { path: [g.attr], equals: g.value } },
      include: { guards: true },
    });
    const known = new Set((existing?.affected_merchants as string[] | undefined) ?? []);
    if (existing && merchants.every((m) => known.has(m))) continue;
    // ponytail: counts are the last 24 h of findings; a merchant whose finding ages out of the window
    // drops off when the group next grows. Keep per-merchant amounts on the row if that matters.
    const data = {
      check: g.check, signature: { ...Object.fromEntries(ATTRS.map((a) => [a, shared(g, a)]).filter(([, v]) => v)), [g.attr]: g.value, since }, affected_merchants: merchants, total_amount: total,
      first_seen: g.rows.reduce((m, r) => (r.opened_at < m ? r.opened_at : m), g.rows[0].opened_at),
    };
    // ponytail: no cross-process lock. Two serverless instances finishing a drain in the same second
    // could both create this row; an advisory lock around find-or-create fixes it if that shows up.
    const rc = existing ? await db.rootCause.update({ where: { id: existing.id }, data }) : await db.rootCause.create({ data });
    const t0 = Date.now();
    const n = await narrate(rc, g, per);
    await db.rootCause.update({ where: { id: rc.id }, data: { summary: n.summary, ticket_md: n.ticket_md } });
    const params = guardParams(g, n);
    if (!existing?.guards.length && params)
      await db.guardRule.create({ data: { template: n.guard.template, params, root_cause_id: rc.id, enabled: false } });
    await trace({ kind: "DETECT", name: existing ? "root_cause.updated" : "root_cause.found", ms: Date.now() - t0, payload: { root_cause_id: rc.id, ...data, guard: n.guard } });
    if (!existing) await alertOps(rc.id, g, merchants.length, total);
    out.push({ id: rc.id, created: !existing, merchants: merchants.length, total });
  }
  return out;
}

async function alertOps(id: string, g: Group, n: number, total: number) {
  const ops = process.env.OPS_EMPLOYEE_PHONE;
  if (!ops) return;
  const what = g.attr === "location" ? `warehouse ${g.value}` : `agent ${g.value}`;
  const text = `Hisaab: root cause mila. ${n} merchants pe ek hi bug, sab ${what} se juda. Total ${rs(total)} galat kata. Ticket aur guard ready hai, ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/ops pe dekho aur guard enable karo. Ref ${id.slice(-6)}`;
  const sent = await sendText(ops, text).catch(() => ({ ok: false }));
  await trace({ kind: "MESSAGE", name: sent.ok ? "whatsapp.sent" : "message.mirrored", payload: { to: "ops", text, root_cause_id: id } });
}

// Debounced: a burst of drains (one injection hitting five shops) becomes one pass ~5 s after the
// last of them. A drain that lands while a pass runs gets its own pass after it.
let due = 0;
let running: Promise<void> | null = null;
export function scheduleRootCauses(ms = 5000): Promise<void> {
  due = Date.now() + ms;
  return (running ??= (async () => {
    for (let ran = 0; ran < due; ) {
      while (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now()));
      ran = Date.now();
      await findRootCauses().catch((e) => console.error("[root-cause] failed", (e as Error)?.message || e));
    }
    running = null;
  })());
}
