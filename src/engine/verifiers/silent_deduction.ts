import * as billing from "@/systems/billing";
import { no, str, sum, type Verifier } from "./common";

const THRESHOLD = 2000;

// refs: { merchant_id }
export const silent_deduction: Verifier = async (refs, ctx) => {
  const merchant_id = ctx?.merchant_id ?? str(refs, "merchant_id");
  if (!merchant_id) return no("No merchant", refs);
  const queued = (await billing.chargesFor(merchant_id, { status: "BILLED" })).filter((c) => !c.notice_sent_at);
  const amount = sum(queued);
  const out = { merchant_id, charge_ids: queued.map((c) => c.id) };
  if (amount <= THRESHOLD) return no("Queued dues are small or already notified", out);
  return { ok: true, verdict: "WARN", amount, refs: out, title: `${queued.length} dues queued for the next settlement with no notice to the merchant` };
};
