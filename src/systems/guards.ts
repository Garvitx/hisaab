// Guard rules (hisaab.guard_rules) enforced inside the silo write paths, so a guard ops enabled
// stops a bad charge or deduction for every merchant before it ever touches a ledger.
import { db } from "@/lib/db";

export const TEMPLATES = ["pause_rent_after_warehouse_receipt", "block_duplicate_deduction", "block_charge_without_delivery"] as const;
export type Template = (typeof TEMPLATES)[number];
type Rule = { id: string; template: string; params: unknown };

const enabled = (templates: Template[]) => db.guardRule.findMany({ where: { enabled: true, template: { in: templates } }, select: { id: true, template: true, params: true } });
const param = (r: Rule, k: string) => (r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>)[k] : undefined);

// The rule that blocks this charge, or null. A RENT/LATE_FEE for period P is blocked when the
// device's latest warehouse receipt is at the rule's location and before P starts.
export async function chargeBlocker(c: { subscription_id: string; period: string }): Promise<Rule | null> {
  const rules = await enabled(["pause_rent_after_warehouse_receipt", "block_charge_without_delivery"]);
  if (!rules.length) return null;
  const sub = await db.subscription.findUnique({ where: { id: c.subscription_id }, select: { device_id: true } });
  const events = sub ? await db.deviceEvent.findMany({ where: { device_id: sub.device_id }, orderBy: { at: "asc" } }) : [];
  const received = events.findLast((e) => e.type === "RECEIVED_AT_WAREHOUSE");
  const start = new Date(`${c.period}-01T00:00:00Z`);
  for (const r of rules) {
    if (r.template === "pause_rent_after_warehouse_receipt" && received && received.location === param(r, "location") && received.at < start) return r;
    if (r.template === "block_charge_without_delivery" && !events.some((e) => e.type === "DELIVERED")) return r;
  }
  return null;
}

// A deduction whose source was already deducted once is a duplicate.
export async function deductionBlocker(d: { source_ref: string | null }): Promise<Rule | null> {
  if (!d.source_ref) return null;
  const [rule] = await enabled(["block_duplicate_deduction"]);
  if (!rule) return null;
  return (await db.deduction.count({ where: { source_ref: d.source_ref } })) ? rule : null;
}

export const recordBlock = (rule: Rule, merchant_id: string, blocked_record: object) =>
  db.$transaction([
    db.guardEvent.create({ data: { guard_rule_id: rule.id, merchant_id, blocked_record } }),
    db.guardRule.update({ where: { id: rule.id }, data: { blocked_count: { increment: 1 } } }),
  ]);
