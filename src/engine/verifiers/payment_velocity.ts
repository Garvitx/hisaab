import { db } from "@/lib/db";
import { no, str, sum, type Verifier } from "./common";

// Card/UPI testing: one payer firing many tiny payments in minutes to probe that a QR accepts money.
const WINDOW_MS = 5 * 60_000;
const MIN_COUNT = 5;
const MAX_AMOUNT = 10;

// refs: { merchant_id } to scan, or { payer_vpa, first_payment_id } to re-check one burst.
// The burst is keyed by its FIRST payment, so later payments in the same burst don't open new cases.
export const payment_velocity: Verifier = async (refs, ctx) => {
  const merchant_id = ctx?.merchant_id ?? str(refs, "merchant_id");
  if (!merchant_id) return no("No merchant", refs);
  const recent = await db.payment.findMany({
    where: { merchant_id, status: "SUCCESS", amount: { lte: MAX_AMOUNT }, created_at: { gte: new Date(Date.now() - 60 * 60_000) } },
    orderBy: { created_at: "asc" },
    select: { id: true, payer_vpa: true, amount: true, created_at: true },
  });
  const want = str(refs, "payer_vpa");
  const byPayer = new Map<string, typeof recent>();
  for (const p of recent) if (!want || p.payer_vpa === want) byPayer.set(p.payer_vpa, [...(byPayer.get(p.payer_vpa) ?? []), p]);

  for (const [payer_vpa, ps] of byPayer) {
    // Slide a 5-minute window; the first window with enough payments is the burst.
    for (let i = 0; i < ps.length; i++) {
      const burst = ps.filter((p) => +p.created_at >= +ps[i].created_at && +p.created_at - +ps[i].created_at <= WINDOW_MS);
      if (burst.length < MIN_COUNT) continue;
      const first = str(refs, "first_payment_id");
      if (first && burst[0].id !== first) continue;
      return {
        ok: true,
        verdict: "WARN",
        amount: sum(burst),
        refs: { payer_vpa, first_payment_id: burst[0].id },
        title: `${burst.length} tiny payments (₹${MAX_AMOUNT} or less) from one payer within 5 minutes: possible card/UPI testing`,
      };
    }
  }
  return no("No burst of tiny payments from one payer", { merchant_id });
};
