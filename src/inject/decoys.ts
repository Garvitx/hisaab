// Decoys: real-looking ledger noise that no verifier in CLAUDE.md section 6 may flag.
import { randomInt } from "node:crypto";
import type { Injector } from "./anomalies";
import { DAY, at, cleanSoundbox, customerVpa, monthStart, orderRef, rentCharges, rupees, settlementOnOrAfter, sql, today, txnRef } from "./lib";

// Rent for the latest month went 5 days late, so it and a ₹54 late fee land in the same later
// settlement. Delivered, active device; one rent per period; every deduction has its own source.
export const legit_late_fee: Injector = (p) => {
  const c = p.ctx, { sub } = cleanSoundbox(p);
  const rent = rentCharges(c, sub.id, 2).reverse().find((x) => monthStart(x.period) + 6 * DAY < today());
  if (!rent) throw new Error(`legit_late_fee: no rent old enough on ${c.mid}`);
  const s = settlementOnOrAfter(c, monthStart(rent.period) + 5 * DAY);
  p.moveChargeDeduction(rent, s);
  const fee = p.insert("billing.charges", { subscription_id: sub.id, merchant_id: c.mid, period: rent.period, kind: "LATE_FEE", amount: 54, status: "DEDUCTED", deducted_in_settlement_id: s.id });
  p.deduct(s, "LATE_FEE", fee.amount, fee.id);
  return { summary: `rent ${rent.period} paid late with ${rupees(fee.amount)} fee on ${s.date}`, params: { amount: fee.amount, rent_charge_id: rent.id, fee_charge_id: fee.id, settlement_id: s.id } };
};

// The merchant refunded a customer ₹500 from their own app: SUCCESS, then REFUNDED.
export const merchant_refund: Injector = (p) => {
  const pay = p.insert("settlement.payments", { merchant_id: p.ctx.mid, txn_ref: txnRef(), amount: 500, payer_vpa: customerVpa(), order_ref: orderRef(), status: "SUCCESS", created_at: new Date(Date.now() - 95 * 60_000) });
  p.update("settlement.payments", pay.id, { status: "REFUNDED" });
  return { summary: `merchant refunded ${rupees(pay.amount)} to ${pay.payer_vpa}`, params: { amount: pay.amount, payment_id: pay.id, initiated_by: "merchant" } };
};

// The latest Sunday settlement drops to ~30% of the merchant's average. The payments it pays out
// are thinned to match, so payments and gross still reconcile.
export const slow_day: Injector = async (p) => {
  const c = p.ctx, recent = c.settlements.filter((x) => x.day >= today() - 28 * DAY);
  const sundays = recent.filter((x) => new Date(x.day).getUTCDay() === 0).reverse();
  const s = sundays.find((x) => x.deductions_total === 0) ?? sundays[0];
  if (!s) throw new Error(`slow_day: no Sunday settlement on ${c.mid}`);
  const others = recent.filter((x) => x.id !== s.id), avg = others.reduce((a, x) => a + x.gross, 0) / others.length, target = Math.round(avg * 0.3);
  const pays = (await sql().query(
    `SELECT id, amount FROM settlement.payments p WHERE merchant_id = $1 AND status = 'SUCCESS' AND created_at >= $2 AND created_at < $3
       AND NOT EXISTS (SELECT 1 FROM disputes.disputes d WHERE d.payment_id = p.id)`,
    [c.mid, at(s.day - DAY, 0).toISOString(), at(s.day, 0).toISOString()],
  )) as { id: string; amount: number }[];
  for (let i = pays.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pays[i], pays[j]] = [pays[j], pays[i]]; }
  let kept = 0;
  const drop = pays.filter((x) => (kept + x.amount <= target ? ((kept += x.amount), false) : true));
  const gross = s.gross - drop.reduce((a, x) => a + x.amount, 0);
  // ponytail: thinned payments are deleted; a delete fires no outbox event, the settlement update does.
  p.raw(`DELETE FROM settlement.payments WHERE id = ANY($1::text[])`, [drop.map((x) => x.id)]);
  p.settle(s.id, { gross: gross - s.gross });
  return {
    summary: `Sunday ${s.date} settlement ${rupees(s.gross)} -> ${rupees(gross)} (avg ${rupees(Math.round(avg))})`,
    params: { settlement_id: s.id, gross_before: s.gross, gross, avg: Math.round(avg), payments_removed: drop.length },
  };
};
