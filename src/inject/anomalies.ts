// One injector per anomaly in CLAUDE.md section 7. Each plans ledger rows against a snapshot of
// the merchant; index.ts commits the plan plus the hisaab.injections row in one transaction.
import { randomInt } from "node:crypto";
import {
  DAY, IST, type Plan, addSoundbox, at, cleanSoundbox, courier, customerVpa, type Device, lastPeriods, latest,
  BUSY_AVG, BUSY_MIN, MARKET_NOW, monthStart, nextPeriod, orderRef, periodOf, rentCharges, rupees, settlementOnOrAfter, sql, today, txnRef,
} from "./lib";

export type Result = { summary: string; params: Record<string, unknown> };
export type Injector = (p: Plan, opts: { failed?: boolean }) => Result | Promise<Result>;

const LATE_FEE = 18; // per overdue month; three of them make the demo's ₹54
const day = (d: number | Date) => new Date(d).toISOString().slice(0, 10);

// Device came back ~4 months ago but billing never stopped: the last 4 rents (re-homed out of
// their monthly settlements) plus late fees are swept into the latest settlement. Demo: 4×135 + 3×18 = ₹594.
export const rent_after_return: Injector = (p) => {
  const c = p.ctx, { sub, device } = cleanSoundbox(p), rents = rentCharges(c, sub.id, 4);
  if (rents.length < 4) throw new Error(`rent_after_return: ${c.mid} has only ${rents.length} rent charges`);
  const picked = at(monthStart(rents[0].period) - 5 * DAY, 12), received = new Date(picked.getTime() + 3 * DAY);
  p.insert("logistics.device_events", { device_id: device.id, type: "PICKED_UP", at: picked, actor: courier() });
  p.insert("logistics.device_events", { device_id: device.id, type: "RECEIVED_AT_WAREHOUSE", at: received, actor: "Paytm warehouse, Okhla" });
  const s = latest(c, rents.reduce((a, x) => a + x.amount, 0) + 3 * LATE_FEE);
  for (const r of rents) p.moveChargeDeduction(r, s);
  const fees = rents.slice(0, 3).map((r) => {
    const f = p.insert("billing.charges", { subscription_id: sub.id, merchant_id: c.mid, period: r.period, kind: "LATE_FEE", amount: LATE_FEE, status: "DEDUCTED", deducted_in_settlement_id: s.id });
    p.deduct(s, "LATE_FEE", f.amount, f.id);
    return f;
  });
  const amount = [...rents, ...fees].reduce((a, x) => a + x.amount, 0);
  return {
    summary: `${device.serial} returned ${day(received)}, ${rents.length} rents + ${fees.length} late fees = ${rupees(amount)} deducted on ${s.date}`,
    params: { amount, device_id: device.id, subscription_id: sub.id, settlement_id: s.id, charge_ids: [...rents, ...fees].map((x) => x.id) },
  };
};

// A second Soundbox that was dispatched but never delivered, billed for 3 months: ₹405.
export const ghost_device: Injector = (p) => {
  const { device, sub, charges } = addSoundbox(p, 3, false), amount = charges.reduce((a, x) => a + x.amount, 0);
  return {
    summary: `ghost ${device.serial} (dispatched, never delivered) billed ${charges.length} months = ${rupees(amount)}`,
    params: { amount, device_id: device.id, subscription_id: sub.id, charge_ids: charges.map((x) => x.id) },
  };
};

// ₹2,800 of dues billed for next period, queued for the next settlement, no notice sent.
export const silent_deduction: Injector = (p) => {
  const { sub } = cleanSoundbox(p);
  const ch = p.insert("billing.charges", { subscription_id: sub.id, merchant_id: p.ctx.mid, period: nextPeriod(periodOf(today())), kind: "RENT", amount: 2800, status: "BILLED", notice_sent_at: null });
  return { summary: `${rupees(ch.amount)} BILLED for ${ch.period}, no notice`, params: { amount: ch.amount, charge_id: ch.id, subscription_id: sub.id } };
};

// A ₹1,850 payment with no order from a VPA that never paid here before, disputed and
// deducted in the latest settlement; the merchant has contested it.
export const orphan_dispute: Injector = (p) => {
  const c = p.ctx, amount = 1850, d = today() - 9 * DAY, s = latest(c, amount);
  const pay = p.insert("settlement.payments", { merchant_id: c.mid, txn_ref: txnRef(), amount, payer_vpa: `qwikpay.${randomInt(100, 999)}@ybl`, order_ref: null, status: "SUCCESS", created_at: at(d, 15.3) });
  p.settle(settlementOnOrAfter(c, d + DAY).id, { gross: amount }); // it was part of the next day's payout
  const dis = p.insert("disputes.disputes", {
    merchant_id: c.mid, payment_id: pay.id, amount, reason: "Customer says goods not received", raised_by_vpa: pay.payer_vpa,
    status: "DEDUCTED", deducted_at: at(s.day, 6), response_due_at: new Date(today() + 5 * DAY), merchant_contested: true,
  });
  p.deduct(s, "DISPUTE", amount, dis.id);
  return { summary: `dispute ${rupees(amount)} on ${pay.txn_ref} from ${pay.payer_vpa}, deducted, merchant contested`, params: { amount, payment_id: pay.id, dispute_id: dis.id, settlement_id: s.id } };
};

// Loan settled in full at the offer amount, yet still ACTIVE and an EMI was taken afterwards.
export const zombie_loan: Injector = (p) => {
  const c = p.ctx;
  let loan = c.loans.find((l) => l.status === "ACTIVE" && l.settlement_offer_amount === null);
  if (!loan) {
    // No loan to work with: book one with EMIs on the 5th, like the seed.
    const principal = 30_000, emi = principal / 12;
    const emiDays = lastPeriods(6).map((x) => monthStart(x) + 4 * DAY).filter((d) => d < today());
    loan = p.insert("lending.loans", { merchant_id: c.mid, principal, outstanding: principal - emi * emiDays.length, status: "ACTIVE", settlement_offer_amount: null });
    for (const d of emiDays) {
      const lp = p.insert("lending.loan_payments", { loan_id: loan.id, amount: emi, kind: "EMI", at: at(d, 6) });
      p.deduct(settlementOnOrAfter(c, d), "LOAN_EMI", emi, lp.id);
    }
  }
  const emi = Math.round(loan.principal / 12), offer = Math.round((loan.outstanding * 0.6) / 100) * 100, s = latest(c, emi);
  const paid = p.insert("lending.loan_payments", { loan_id: loan.id, amount: offer, kind: "SETTLEMENT", at: at(today() - 18 * DAY, 11) });
  const lp = p.insert("lending.loan_payments", { loan_id: loan.id, amount: emi, kind: "EMI", at: at(s.day, 6) });
  p.deduct(s, "LOAN_EMI", emi, lp.id);
  p.update("lending.loans", loan.id, { settlement_offer_amount: offer, outstanding: loan.outstanding - emi });
  return {
    summary: `loan settled at ${rupees(offer)} but still ACTIVE; EMI ${rupees(emi)} deducted after`,
    params: { amount: emi, loan_id: loan.id, offer, settlement_payment_id: paid.id, emi_payment_id: lp.id, settlement_id: s.id },
  };
};

// The same rent charge deducted a second time in the latest settlement: ₹135.
export const duplicate_deduction: Injector = (p) => {
  const c = p.ctx, { sub } = cleanSoundbox(p), s = latest(c, 135);
  const ch = rentCharges(c, sub.id, 2).reverse().find((x) => x.deducted_in_settlement_id !== s.id);
  if (!ch) throw new Error(`duplicate_deduction: no earlier rent charge on ${c.mid}`);
  const d = p.deduct(s, "RENT", ch.amount, ch.id);
  return { summary: `rent ${ch.period} (${rupees(ch.amount)}) deducted again on ${s.date}`, params: { amount: ch.amount, charge_id: ch.id, deduction_id: d.id, settlement_id: s.id } };
};

// A ₹299 FEE with nothing behind it.
export const deduction_without_source: Injector = (p) => {
  const s = latest(p.ctx, 299), d = p.deduct(s, "FEE", 299, null);
  return { summary: `FEE ${rupees(d.amount)} with no source on ${s.date}`, params: { amount: d.amount, deduction_id: d.id, settlement_id: s.id } };
};

// The Soundbox in use stops heartbeating: last seen 3 hours ago.
export const device_offline: Injector = (p) => {
  // Still at the shop: delivered and never collected (a pending pickup request still counts).
  const atShop = (d: Device) => d.events.includes("DELIVERED") && !d.events.some((t) => t === "PICKED_UP" || t === "RECEIVED_AT_WAREHOUSE");
  const dev = p.ctx.devices.filter((d) => d.model === "SOUNDBOX" && atShop(d)).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0];
  if (!dev) throw new Error(`device_offline: no Soundbox in use on ${p.ctx.mid}`);
  const last = new Date(Date.now() - 3 * 3_600_000);
  p.update("logistics.devices", dev.id, { last_seen_at: last });
  return { summary: `${dev.serial} last seen 3 h ago`, params: { device_id: dev.id, last_seen_at: last } };
};

// A ₹500 customer payment a few minutes ago, stuck PENDING (or FAILED).
export const pending_payment: Injector = (p, { failed }) => {
  const pay = p.insert("settlement.payments", { merchant_id: p.ctx.mid, txn_ref: txnRef(), amount: 500, payer_vpa: customerVpa(), order_ref: orderRef(), status: failed ? "FAILED" : "PENDING", created_at: new Date(Date.now() - 4 * 60_000) });
  return { summary: `${rupees(pay.amount)} from ${pay.payer_vpa} ${pay.status} (UPI ${pay.txn_ref})`, params: { amount: pay.amount, payment_id: pay.id, status: pay.status, txn_ref: pay.txn_ref } };
};

// Pickup requested ~2 months ago, never collected, and the last 2 rents still billed: ₹270.
export const pickup_never_completed: Injector = (p) => {
  const { sub, device } = cleanSoundbox(p), rents = rentCharges(p.ctx, sub.id, 2);
  const requested = at(monthStart(rents[0].period) - 3 * DAY, 10);
  const e = p.insert("logistics.device_events", { device_id: device.id, type: "PICKUP_REQUESTED", at: requested, actor: "merchant (Paytm for Business app)" });
  const amount = rents.reduce((a, x) => a + x.amount, 0);
  return {
    summary: `pickup of ${device.serial} requested ${day(requested)}, never picked up; ${rents.length} rents = ${rupees(amount)} since`,
    params: { amount, device_id: device.id, event_id: e.id, subscription_id: sub.id, charge_ids: rents.map((x) => x.id) },
  };
};

// Card testing: 8 tiny SUCCESS payments (₹23 in all) from one VPA inside ~2 minutes.
export const velocity_burst: Injector = (p) => {
  const vpa = `cardtest.${randomInt(1000, 10_000)}@ybl`, now = Date.now();
  const pays = [1, 2, 5, 3, 1, 4, 2, 5].map((amount, i) =>
    p.insert("settlement.payments", {
      merchant_id: p.ctx.mid, txn_ref: txnRef(), amount, payer_vpa: vpa, payer_name: null, order_ref: orderRef(),
      status: "SUCCESS", created_at: new Date(now - 120_000 + Math.round((i * 115_000) / 7)),
    }),
  );
  const amount = pays.reduce((a, x) => a + x.amount, 0);
  return { summary: `${pays.length} payments of ₹1–5 (${rupees(amount)}) from ${vpa} in 2 min`, params: { amount, payer_vpa: vpa, payment_ids: pays.map((x) => x.id) } };
};

// The QR standee was swapped: this shop's payments stop for the last 150 minutes while the
// market keeps going. Deletes fire no trigger, so the outbox row is written by hand.
export const qr_swapped: Injector = async (p) => {
  const c = p.ctx;
  const [{ g, n, avg: avg0 }] = (await sql().query(
    `SELECT ${MARKET_NOW}::text g, (SELECT count(*)::int FROM settlement.payments WHERE merchant_id = $1 AND created_at > ${MARKET_NOW} - interval '150 minutes') n,
       (SELECT avg::float FROM (${BUSY_AVG}) b WHERE merchant_id = $1) avg`,
    [c.mid],
  )) as { g: string; n: number; avg: number | null }[];
  const avg = Math.round((avg0 ?? 0) * 10) / 10;
  const from = Date.parse(`${g.replace(" ", "T")}Z`) - 150 * 60_000;
  // Settlement D pays out day D-1, and there is none for today yet, so nothing in the window is settled.
  if (Math.floor((from + IST) / DAY) * DAY < latest(c).day) throw new Error(`qr_swapped: window on ${c.mid} reaches into a settled day`);
  p.raw(`DELETE FROM settlement.payments WHERE merchant_id = $1 AND created_at > $2`, [c.mid, new Date(from).toISOString()]);
  p.raw(`INSERT INTO hisaab.outbox_events ("schema", "table", row_id, op, merchant_id) VALUES ('settlement', 'payments', $1, 'DELETE', $2)`, [`qr_swapped:${p.injection_id}`, c.mid]);
  // An explicit target is injected even when quiet, but flagged: the rule may rightly stay silent.
  const quiet = avg < BUSY_MIN ? ` (only ${avg} payments/day in this slot, under ${BUSY_MIN}: payments_stopped may not fire)` : "";
  return {
    summary: `${n} payments since ${new Date(from + IST).toISOString().slice(11, 16)} IST removed; market still live${quiet}`,
    params: { market_now: g, removed_after: new Date(from), removed: n, slot_avg: avg },
  };
};
