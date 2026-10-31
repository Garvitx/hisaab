import * as settlement from "@/systems/settlement";
import { no, str, sum, type Verifier } from "./common";

// refs: { source_ref } or { deduction_id }
export const duplicate_deduction: Verifier = async (refs, ctx) => {
  let source_ref = str(refs, "source_ref");
  const did = str(refs, "deduction_id");
  if (!source_ref && did) source_ref = (await settlement.deduction(did))?.source_ref ?? undefined;
  if (!source_ref) return no("No source to check", refs);
  const rows = (await settlement.deductionsBySource([source_ref])).filter((d) => !ctx?.merchant_id || d.merchant_id === ctx.merchant_id);
  rows.sort((a, b) => +a.settlement.date - +b.settlement.date || +a.created_at - +b.created_at);
  // The first settlement that deducted it was right; every other settlement deducted it again.
  const extra = rows.filter((d) => d.settlement_id !== rows[0]?.settlement_id);
  const out = { source_ref, deduction_ids: extra.map((d) => d.id) };
  if (!extra.length) return no("Deducted only once", out);
  return { ok: true, verdict: "WRONG", amount: sum(extra), refs: out, title: `${rows[0].type} deducted again in ${extra.length} later settlement${extra.length > 1 ? "s" : ""}` };
};
