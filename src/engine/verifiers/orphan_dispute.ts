import * as disputes from "@/systems/disputes";
import * as settlement from "@/systems/settlement";
import { mine, no, str, type Verifier } from "./common";

// refs: { dispute_id }
export const orphan_dispute: Verifier = async (refs, ctx) => {
  const id = str(refs, "dispute_id");
  const d = id ? await disputes.get(id) : null;
  if (!mine(d, ctx)) return no("Dispute not found", refs);
  const p = await settlement.payment(d!.payment_id);
  const out = { dispute_id: d!.id, payment_id: d!.payment_id };
  // Already contested or decided disputes have nothing left to do.
  if (d!.status !== "OPEN" && d!.status !== "DEDUCTED") return no(`Dispute is ${d!.status}`, out);
  if (!p || p.order_ref !== null || !d!.merchant_contested) return no("Dispute is backed by an order or not contested", out);
  return { ok: true, verdict: "CONTESTABLE", amount: d!.amount, refs: out, title: `Dispute on a payment with no order, contested by the merchant (${p.payer_vpa})` };
};
