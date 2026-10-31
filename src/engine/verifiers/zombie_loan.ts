import * as lending from "@/systems/lending";
import * as settlement from "@/systems/settlement";
import { mine, no, str, sum, type Verifier } from "./common";

// refs: { loan_id }
export const zombie_loan: Verifier = async (refs, ctx) => {
  const id = str(refs, "loan_id");
  const loan = id ? await lending.loan(id) : null;
  if (!mine(loan, ctx)) return no("Loan not found", refs);
  const settlements = loan!.payments.filter((p) => p.kind === "SETTLEMENT");
  const out: Record<string, unknown> = { loan_id: loan!.id };
  if (loan!.status !== "ACTIVE" || loan!.settlement_offer_amount == null || sum(settlements) < loan!.settlement_offer_amount)
    return no("Loan is not settled-but-active", out);
  // Amount: EMIs still deducted after the loan was settled. The status mismatch is the finding even at zero.
  const settledAt = settlements[settlements.length - 1].at;
  const sources = [loan!.id, ...loan!.payments.map((p) => p.id)];
  const after = (await settlement.deductionsBySource(sources)).filter(
    (d) => d.type === "LOAN_EMI" && d.merchant_id === loan!.merchant_id && d.created_at > settledAt,
  );
  out.deduction_ids = after.map((d) => d.id);
  return { ok: true, verdict: "MISMATCH", amount: sum(after), refs: out, title: `Loan settled on ${settledAt.toISOString().slice(0, 10)} but still ACTIVE, EMIs still deducted` };
};
