import * as billing from "@/systems/billing";
import * as settlement from "@/systems/settlement";
import { mine, no, str, type Verifier } from "./common";

// refs: { deduction_id }
export const deduction_without_source: Verifier = async (refs, ctx) => {
  const id = str(refs, "deduction_id");
  const d = id ? await settlement.deduction(id) : null;
  if (!mine(d, ctx)) return no("Deduction not found", refs);
  const out = { deduction_id: d!.id };
  if (d!.type !== "FEE" || d!.source_ref !== null) return no("Deduction has a source", out);
  // "No matching record": no billing charge deducted in that settlement for that amount.
  const match = (await billing.chargesFor(d!.merchant_id)).some((c) => c.deducted_in_settlement_id === d!.settlement_id && c.amount === d!.amount);
  if (match) return no("A matching charge exists", out);
  return { ok: true, verdict: "WRONG", amount: d!.amount, refs: out, title: `Fee deducted on ${d!.settlement.date.toISOString().slice(0, 10)} with no charge behind it` };
};
