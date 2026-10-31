import { db } from "@/lib/db";
import { no, str, type Verifier } from "./common";

const GAP_MS = 2 * 3_600_000;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

// A busy shop that went silent while the rest of the market kept getting paid: the classic sign of
// a fraudster's QR sticker pasted over the merchant's. "Now" is the market's latest real payment,
// not the wall clock: the seeded ledger is static, and against the wall clock every shop would look
// silent a couple of hours after a reset. Pay-page test payments (@demo) don't count as the market.
// refs: { merchant_id }
export const payments_stopped: Verifier = async (refs, ctx) => {
  const merchant_id = ctx?.merchant_id ?? str(refs, "merchant_id");
  if (!merchant_id) return no("No merchant", refs);

  const market = await db.payment.findFirst({
    where: { status: "SUCCESS", NOT: { payer_vpa: { endsWith: "@demo" } } },
    orderBy: { created_at: "desc" },
    select: { created_at: true },
  });
  if (!market) return no("No market activity", { merchant_id });
  const G = +market.created_at;
  const hour = new Date(G + IST).getUTCHours();
  if (hour < 11 || hour >= 22) return no("Outside business hours", { merchant_id }); // a 2 h gap before 11:00 is just the morning

  const last = await db.payment.findFirst({ where: { merchant_id, status: "SUCCESS" }, orderBy: { created_at: "desc" }, select: { created_at: true } });
  const silentFor = last ? G - +last.created_at : Infinity;
  if (silentFor < GAP_MS) return no("Payments are flowing", { merchant_id });

  // Only a shop that is normally busy in this slot: on average 6+ payments in the same 2 hours over the last week.
  // At 3, a plain chance gap (Poisson e^-3, ~5%) would flag a shop or two on every reset; at 6 it's ~0.25%.
  const counts = await Promise.all(
    [1, 2, 3, 4, 5, 6, 7].map((d) =>
      db.payment.count({ where: { merchant_id, status: "SUCCESS", created_at: { gte: new Date(G - d * DAY - GAP_MS), lte: new Date(G - d * DAY) } } }),
    ),
  );
  const usual = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (usual < 6) return no("Usually quiet at this hour", { merchant_id });

  return {
    ok: true,
    verdict: "WARN",
    amount: 0,
    refs: { merchant_id, silent_since: last?.created_at.toISOString() ?? null },
    title: `No payments for ${Math.floor(silentFor / 3_600_000)}+ hours while usually ~${Math.round(usual)} come in by now: check the QR standee`,
  };
};
