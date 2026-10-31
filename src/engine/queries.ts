// Read-only answers for merchant questions. The engine computes every number the
// concierge says (rule 1); the model only phrases them. Days are IST calendar days.
import { db } from "@/lib/db";
import * as billing from "@/systems/billing";
import * as lending from "@/systems/lending";
import * as logistics from "@/systems/logistics";
import * as settlement from "@/systems/settlement";
import { khataPeriod } from "@/khata/balances";

const IST = 5.5 * 3_600_000;
const DAY = 86_400_000;
const LABEL: Record<string, string> = { RENT: "Soundbox/EDC rent", LATE_FEE: "Late fee", DISPUTE: "Dispute (chargeback)", LOAN_EMI: "Loan EMI", FEE: "Fee" };

// "2026-10-31" for the IST day containing t.
export const istDay = (t: Date | number = Date.now()) => new Date(+t + IST).toISOString().slice(0, 10);
// [start, end) of an IST day as UTC instants.
const dayRange = (day: string) => {
  const start = Date.parse(`${day}T00:00:00Z`) - IST;
  return { gte: new Date(start), lt: new Date(start + DAY) };
};
const addDays = (day: string, n: number) => istDay(Date.parse(`${day}T00:00:00Z`) - IST + n * DAY + 1);
const clock = (t: Date) => new Date(+t + IST).toISOString().slice(11, 16);
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const settlementDate = (day: string) => new Date(`${day}T00:00:00Z`); // @db.Date column

export async function findPayment(merchant_id: string, q: { amount?: number; from?: string; to?: string; payer_vpa?: string; upi_ref?: string }) {
  const from = q.from ? dayRange(q.from).gte : new Date(Date.now() - 2 * DAY);
  const to = q.to ? dayRange(q.to).lt : new Date(Date.now() + 60_000);
  // A UPI reference is exact and dated by the payer's app, so it ignores the date window.
  const ref = q.upi_ref?.replace(/\D/g, "");
  const rows = await db.payment.findMany({
    where: ref
      ? { merchant_id, txn_ref: ref }
      : { merchant_id, amount: q.amount, created_at: { gte: from, lt: to }, OR: q.payer_vpa ? [{ payer_vpa: { contains: q.payer_vpa, mode: "insensitive" } }, { payer_name: { contains: q.payer_vpa, mode: "insensitive" } }] : undefined },
    orderBy: { created_at: "desc" },
    take: 10,
  });
  return {
    matches: rows.map((p) => ({
      amount: p.amount,
      status: p.status,
      upi_ref: p.txn_ref,
      payer: p.payer_name ?? p.payer_vpa,
      at: `${istDay(p.created_at)} ${clock(p.created_at)} IST`,
      settles_on: p.status === "SUCCESS" ? addDays(istDay(p.created_at), 1) : null,
    })),
    note: rows.length ? undefined : ref ? "No payment with this UPI reference ever reached this merchant." : "No payment matched in this window.",
  };
}

// Deductions scheduled for the settlement on `day`: rent on the 1st, loan EMI on the 5th,
// plus any BILLED dues already queued.
async function scheduledFor(merchant_id: string, day: string) {
  const items: { type: string; label: string; amount: number }[] = [];
  const dom = Number(day.slice(8, 10));
  if (dom === 1) {
    for (const s of await billing.subscriptions(merchant_id))
      if (s.status === "ACTIVE") items.push({ type: "RENT", label: `${s.plan} rent for ${day.slice(0, 7)}`, amount: s.monthly_rent });
  }
  if (dom === 5) {
    for (const l of await lending.loans(merchant_id)) {
      const emi = [...l.payments].reverse().find((p) => p.kind === "EMI");
      if (l.status === "ACTIVE" && emi) items.push({ type: "LOAN_EMI", label: "Loan EMI", amount: emi.amount });
    }
  }
  for (const c of await billing.chargesFor(merchant_id, { status: "BILLED" }))
    items.push({ type: c.kind, label: `${LABEL[c.kind]} for ${c.period} (pending dues)`, amount: c.amount });
  return items;
}

export async function forecastSettlement(merchant_id: string, day = addDays(istDay(), 1)) {
  const prev = addDays(day, -1);
  const paid = await db.payment.findMany({ where: { merchant_id, status: "SUCCESS", created_at: dayRange(prev) }, select: { amount: true } });
  const gross = sum(paid);
  const deductions = await scheduledFor(merchant_id, day);
  const credits = (await settlement.credits(merchant_id)).filter((c) => !c.applied_settlement_id);
  const deductions_total = sum(deductions);
  const credits_total = sum(credits);
  return {
    settlement_date: day,
    from_payments_on: prev,
    payments_count: paid.length,
    gross,
    deductions,
    deductions_total,
    credits: credits.map((c) => ({ reason: c.reason, amount: c.amount })),
    credits_total,
    expected_payout: gross - deductions_total + credits_total,
    note: prev === istDay() ? "Today's payments are still coming in; this grows until midnight." : undefined,
  };
}

export async function upcomingDeductions(merchant_id: string, until?: string) {
  const start = addDays(istDay(), 1);
  const end = until ?? addDays(start, 30);
  const out: { date: string; type: string; label: string; amount: number }[] = [];
  const queued = (await billing.chargesFor(merchant_id, { status: "BILLED" })).map((c) => ({ date: start, type: c.kind, label: `${LABEL[c.kind]} for ${c.period} (pending dues)`, amount: c.amount }));
  out.push(...queued);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dom = Number(d.slice(8, 10));
    if (dom !== 1 && dom !== 5) continue;
    for (const it of await scheduledFor(merchant_id, d)) if (!it.label.includes("pending dues")) out.push({ date: d, ...it });
  }
  return { from: start, until: end, items: out, total: sum(out) };
}

export async function comparePeriods(merchant_id: string, a: { from: string; to: string }, b: { from: string; to: string }) {
  const one = async (p: { from: string; to: string }) => {
    const range = { gte: dayRange(p.from).gte, lt: dayRange(p.to).lt };
    const pays = await db.payment.findMany({ where: { merchant_id, status: "SUCCESS", created_at: range }, select: { amount: true } });
    const ded = await db.deduction.findMany({ where: { merchant_id, settlement: { date: { gte: settlementDate(p.from), lte: settlementDate(p.to) } } } });
    const byType: Record<string, number> = {};
    for (const d of ded) byType[LABEL[d.type]] = (byType[LABEL[d.type]] ?? 0) + d.amount;
    return { ...p, payments_count: pays.length, payments_total: sum(pays), deductions_total: sum(ded), deductions_by_type: byType };
  };
  const [x, y] = await Promise.all([one(a), one(b)]);
  return { a: x, b: y, payments_total_change: y.payments_total - x.payments_total, deductions_total_change: y.deductions_total - x.deductions_total };
}

// period: "YYYY-MM" (month) or "YYYY-MM-DD" (one settlement).
export async function getStatement(merchant_id: string, period: string) {
  const [y, m] = period.split("-").map(Number);
  // Date.UTC takes a 0-based month, so passing the 1-based m lands on the 1st of the next month.
  const [from, to] = period.length === 7 ? [`${period}-01`, addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1)] : [period, period];
  const rows = await db.settlement.findMany({
    where: { merchant_id, date: { gte: settlementDate(from), lte: settlementDate(to) } },
    include: { deductions: true },
    orderBy: { date: "asc" },
  });
  const chargeIds = rows.flatMap((s) => s.deductions.filter((d) => d.type === "RENT" || d.type === "LATE_FEE").map((d) => d.source_ref!)).filter(Boolean);
  const charges = new Map((await billing.charges(chargeIds)).map((c) => [c.id, c]));
  const credits = (await settlement.credits(merchant_id)).filter((c) => istDay(c.created_at) >= from && istDay(c.created_at) <= to);
  return {
    period,
    settlements_count: rows.length,
    gross_total: rows.reduce((s, r) => s + r.gross, 0),
    deductions_total: rows.reduce((s, r) => s + r.deductions_total, 0),
    net_total: rows.reduce((s, r) => s + r.net, 0),
    // Only days with deductions are itemised; the rest are plain payouts.
    days_with_deductions: rows
      .filter((r) => r.deductions.length)
      .map((r) => ({
        date: istDay(r.date),
        gross: r.gross,
        net: r.net,
        deductions: r.deductions.map((d) => ({ what: LABEL[d.type] + (charges.get(d.source_ref ?? "") ? ` for ${charges.get(d.source_ref!)!.period}` : d.type === "FEE" && !d.source_ref ? " (no linked bill)" : ""), amount: d.amount })),
      })),
    credits: credits.map((c) => ({ reason: c.reason, amount: c.amount, on: istDay(c.created_at) })),
  };
}

export async function deviceHealth(merchant_id: string) {
  await logistics.heartbeat(merchant_id);
  const now = Date.now();
  return {
    devices: (await logistics.devices(merchant_id)).map((d) => ({
      device_id: d.id,
      model: d.model,
      serial: d.serial,
      online: logistics.isOnline(d, now),
      last_seen: `${istDay(d.last_seen_at)} ${clock(d.last_seen_at)} IST`,
      minutes_since_seen: Math.round((now - d.last_seen_at.getTime()) / 60_000),
      open_replacements: d.replacement_requests.filter((r) => r.status === "BOOKED" || r.status === "DISPATCHED").map((r) => ({ status: r.status, booked: istDay(r.created_at) })),
    })),
  };
}

export async function loanSummary(merchant_id: string) {
  return {
    loans: (await lending.loans(merchant_id)).map((l) => ({
      status: l.status,
      principal: l.principal,
      outstanding: l.outstanding,
      emis_paid: l.payments.filter((p) => p.kind === "EMI").length,
      last_emi: l.payments.filter((p) => p.kind === "EMI").at(-1)?.amount ?? null,
    })),
  };
}

export async function dailySummary(merchant_id: string, day = istDay()) {
  const range = dayRange(day);
  const now = Date.now();
  // "Same time yesterday" only makes sense for today; for a past day compare whole days.
  const cutoff = day === istDay() ? now - DAY : dayRange(addDays(day, -1)).lt.getTime();
  const [today, yesterday] = await Promise.all([
    db.payment.findMany({ where: { merchant_id, created_at: range }, orderBy: { created_at: "asc" } }),
    db.payment.findMany({ where: { merchant_id, status: "SUCCESS", created_at: { gte: dayRange(addDays(day, -1)).gte, lt: new Date(cutoff) } }, select: { amount: true } }),
  ]);
  const ok = today.filter((p) => p.status === "SUCCESS");
  const biggest = ok.reduce<(typeof ok)[number] | null>((m, p) => (!m || p.amount > m.amount ? p : m), null);
  const total = sum(ok);
  const yTotal = sum(yesterday);
  return {
    date: day,
    successful_count: ok.length,
    successful_total: total,
    pending_count: today.filter((p) => p.status === "PENDING").length,
    failed_count: today.filter((p) => p.status === "FAILED").length,
    biggest: biggest ? { amount: biggest.amount, payer: biggest.payer_name ?? biggest.payer_vpa, at: clock(biggest.created_at) } : null,
    first_payment_at: ok[0] ? clock(ok[0].created_at) : null,
    last_payment_at: ok.at(-1) ? clock(ok.at(-1)!.created_at) : null,
    scheduled_deductions_today: await scheduledFor(merchant_id, day),
    yesterday_same_time_total: yTotal,
    change_vs_yesterday: total - yTotal,
    next_settlement: await forecastSettlement(merchant_id, addDays(day, 1)),
    // Cash, kharcha and udhaar the merchant told us (self-reported), next to the UPI above (verified by Paytm).
    khata: await khataPeriod(merchant_id, day).then(({ cash, expenses, kamai, net, udhaar }) => ({ self_reported: true, cash: cash.total, expenses: expenses.total, kamai_upi_plus_cash: kamai, net_after_expenses: net, udhaar })),
  };
}

// Loan pre-check from the last 30 days of collections. Indicative only: lending is always a human's
// call (CLAUDE.md section 8), so the caller hands every request to a lending agent with this summary.
export const LOAN = { notYetBelow: 5_000, priorityFrom: 15_000, minActiveDays: 20, priorityActiveDays: 25, limitX: 15, cap: 500_000, emiPct: 0.1, topUpAfter: 0.5 };

export async function loanEligibility(merchant_id: string) {
  const from = new Date(Date.now() - 30 * DAY);
  const pays = await db.payment.findMany({ where: { merchant_id, status: "SUCCESS", created_at: { gte: from } }, select: { amount: true, created_at: true } });
  const avg_daily = Math.round(sum(pays) / 30);
  const active_days = new Set(pays.map((p) => istDay(p.created_at))).size;
  const tier =
    avg_daily < LOAN.notYetBelow || active_days < LOAN.minActiveDays ? "NOT_YET"
    : avg_daily >= LOAN.priorityFrom && active_days >= LOAN.priorityActiveDays ? "PRIORITY"
    : "ELIGIBLE";
  const active = (await lending.loans(merchant_id)).filter((l) => l.status === "ACTIVE");
  const repaid = active.length ? Math.min(...active.map((l) => 1 - l.outstanding / l.principal)) : 1;
  const top_up_blocked = active.length > 0 && repaid < LOAN.topUpAfter;
  const limit = tier === "NOT_YET" ? 0 : Math.min(LOAN.cap, Math.floor((LOAN.limitX * avg_daily) / 5_000) * 5_000);
  const emi = Math.round(avg_daily * LOAN.emiPct);
  const days = limit && emi ? Math.ceil(limit / emi) : null;
  return {
    tier,
    avg_daily_collections: avg_daily,
    active_days_of_30: active_days,
    indicative_limit: limit,
    daily_emi_on_an_average_day: limit ? emi : null,
    emi_rule: "10% of each day's settlement: smaller on slow days, faster payoff on busy days",
    payoff_in_days_at_average: days,
    payoff_by: days ? addDays(istDay(), days) : null,
    existing_loan: active.length ? { outstanding: active.reduce((a, l) => a + l.outstanding, 0), repaid_pct: Math.round(repaid * 100), top_up_blocked } : null,
    needs_for_eligibility: tier === "NOT_YET" ? `average ₹${LOAN.notYetBelow.toLocaleString("en-IN")}/day and payments on ${LOAN.minActiveDays}+ of 30 days` : null,
  };
}