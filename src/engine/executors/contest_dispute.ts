import * as disputes from "@/systems/disputes";
import * as settlement from "@/systems/settlement";
import { ref, type Executor } from "./common";

export const contest_dispute: Executor = async (x) => {
  const id = ref(x, "dispute_id");
  const d = id ? await disputes.get(id) : null;
  if (!d || d.merchant_id !== x.merchant_id) throw new Error("contest_dispute: dispute not found");
  const p = await settlement.payment(d.payment_id);
  const ledger = p && { payment_id: p.id, txn_ref: p.txn_ref, amount: p.amount, payer_vpa: p.payer_vpa, order_ref: p.order_ref, paid_at: p.created_at.toISOString() };
  const text = typeof x.params?.response_text === "string" ? x.params.response_text
    : `Merchant contests this dispute. UPI payment ${p?.txn_ref ?? d.payment_id} of ₹${d.amount} from ${d.raised_by_vpa} has no order on record, ` +
      `and the merchant confirms the payment was received for goods handed over. Requesting reversal of the ₹${d.amount} deduction.`;
  const prior = d.evidence && typeof d.evidence === "object" && !Array.isArray(d.evidence) ? d.evidence : {};
  await disputes.set(d.id, { status: "CONTESTED", response_text: text, evidence: { ...prior, ledger } });
  return [{ op: "dispute", id: d.id, status: d.status, response_text: d.response_text, evidence: d.evidence }];
};
