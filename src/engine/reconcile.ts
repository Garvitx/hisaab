// The rules engine: the first five checks, each discovering its own refs from the ledger.
// The other three are reachable only through the hunter (CLAUDE.md section 6), on purpose.
import * as billing from "@/systems/billing";
import * as disputes from "@/systems/disputes";
import * as lending from "@/systems/lending";
import { verifiers, type Check, type Refs, type Result } from "./verifiers";

export type Candidate = Result & { check: Check };

export async function reconcile(merchant_id: string): Promise<Candidate[]> {
  const [subs, ds, loans] = await Promise.all([billing.subscriptions(merchant_id), disputes.list(merchant_id), lending.loans(merchant_id)]);
  const probes: [Check, Refs][] = [
    ...subs.flatMap((s) => [["charge_after_return", { subscription_id: s.id }], ["charge_without_delivery", { subscription_id: s.id }]] as [Check, Refs][]),
    ["silent_deduction", { merchant_id }],
    ...ds.filter((d) => d.merchant_contested).map((d) => ["orphan_dispute", { dispute_id: d.id }] as [Check, Refs]),
    ...loans.filter((l) => l.status === "ACTIVE" && l.settlement_offer_amount != null).map((l) => ["zombie_loan", { loan_id: l.id }] as [Check, Refs]),
  ];
  const results = await Promise.all(probes.map(async ([check, refs]) => ({ check, ...(await verifiers[check](refs, { merchant_id })) })));
  return results.filter((r) => r.ok);
}
