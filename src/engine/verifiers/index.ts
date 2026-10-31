import type { Ctx, Refs, Result, Verifier } from "./common";
import { charge_after_return } from "./charge_after_return";
import { charge_without_delivery } from "./charge_without_delivery";
import { silent_deduction } from "./silent_deduction";
import { orphan_dispute } from "./orphan_dispute";
import { zombie_loan } from "./zombie_loan";
import { duplicate_deduction } from "./duplicate_deduction";
import { deduction_without_source } from "./deduction_without_source";
import { pickup_never_completed } from "./pickup_never_completed";
import { payment_velocity } from "./payment_velocity";
import { payments_stopped } from "./payments_stopped";

export type { Ctx, Refs, Result, Verifier };

export const verifiers = {
  charge_after_return,
  charge_without_delivery,
  silent_deduction,
  orphan_dispute,
  zombie_loan,
  duplicate_deduction,
  deduction_without_source,
  pickup_never_completed,
  payment_velocity,
  payments_stopped,
} satisfies Record<string, Verifier>;

export type Check = keyof typeof verifiers;
export const CHECKS = Object.keys(verifiers) as Check[];
export const isCheck = (c: string): c is Check => c in verifiers;

// For the hunter prompt: the refs each check accepts.
export const REFS: Record<Check, string> = {
  charge_after_return: "{ subscription_id } or { device_id }",
  charge_without_delivery: "{ subscription_id } or { device_id }",
  silent_deduction: "{ merchant_id }",
  orphan_dispute: "{ dispute_id }",
  zombie_loan: "{ loan_id }",
  duplicate_deduction: "{ source_ref } or { deduction_id }",
  deduction_without_source: "{ deduction_id }",
  pickup_never_completed: "{ device_id } or { subscription_id }",
  payment_velocity: "{ merchant_id } or { payer_vpa, first_payment_id }",
  payments_stopped: "{ merchant_id }",
};

export function verify(check: string, refs: unknown, ctx?: Ctx): Promise<Result> {
  const r = (refs && typeof refs === "object" ? refs : {}) as Refs;
  if (!isCheck(check)) return Promise.resolve({ ok: false, verdict: "OK", amount: 0, title: `Unknown check ${check}`, refs: r });
  return verifiers[check](r, ctx);
}
