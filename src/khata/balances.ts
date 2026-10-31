// Read side of the khata: udhaar per counterparty, and the day's money with sources kept apart
// (UPI is verified by Paytm, cash and udhaar are what the merchant told us).
import { db } from "@/lib/db";
import type { KhataEntry } from "@/generated/prisma/client";

const IST = 5.5 * 3_600_000;
const DAY = 86_400_000;
// Own copies of istDay / entryDate: src/engine/queries.ts imports this file, so no import back.
const istDay = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const entryDate = (day: string) => new Date(`${day}T00:00:00Z`);
const range = (from: string, to = from) => ({ gte: new Date(Date.parse(`${from}T00:00:00Z`) - IST), lt: new Date(Date.parse(`${to}T00:00:00Z`) - IST + DAY) });
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const open = (e: Pick<KhataEntry, "amount" | "settled_amount">) => Math.max(0, e.amount - e.settled_amount);

// One counterparty: a shop by mid, a customer by name (case-insensitive).
export const keyOf = (e: Pick<KhataEntry, "counterparty_mid" | "counterparty_name">) => e.counterparty_mid ?? `c:${(e.counterparty_name ?? "").trim().toLowerCase()}`;

export type Balance = {
  key: string;
  type: "MERCHANT" | "CUSTOMER";
  name: string;
  mid: string | null;
  phone: string | null;
  given: number; // confirmed udhaar given, ever
  taken: number;
  settled: number; // repaid so far, both directions
  lene: number; // they owe me
  dene: number; // I owe them
  outstanding: number; // lene - dene
  remind_entry_id: string | null; // my oldest open UDHAAR_GIVEN: the u= of a reminder link
  pay_entry: { mid: string; id: string } | null; // a shop I owe: their entry, so I can pay it
  waiting_their_ok: number; // I wrote it, the other shop hasn't said Haan yet
  waiting_my_ok: number; // they wrote it, I haven't answered
  disputed: number;
};

// Udhaar balances per counterparty for one merchant. Only CONFIRMED entries count as owed.
export async function udhaarBalances(merchant_id: string): Promise<Balance[]> {
  const rows = await db.khataEntry.findMany({
    where: { merchant_id, kind: { in: ["UDHAAR_GIVEN", "UDHAAR_TAKEN"] }, status: { in: ["CONFIRMED", "PENDING_CONFIRMATION", "DISPUTED"] }, counterparty_type: { not: "NONE" } },
    orderBy: { created_at: "asc" },
  });
  const linkedIds = rows.map((r) => r.linked_entry_id).filter((x): x is string => !!x);
  const linked = new Map((linkedIds.length ? await db.khataEntry.findMany({ where: { id: { in: linkedIds } }, select: { id: true, status: true } }) : []).map((l) => [l.id, l.status]));
  const out = new Map<string, Balance>();
  for (const e of rows) {
    const k = keyOf(e);
    const b = out.get(k) ?? { key: k, type: e.counterparty_type as "MERCHANT" | "CUSTOMER", name: e.counterparty_name ?? "", mid: e.counterparty_mid, phone: null, given: 0, taken: 0, settled: 0, lene: 0, dene: 0, outstanding: 0, remind_entry_id: null, pay_entry: null, waiting_their_ok: 0, waiting_my_ok: 0, disputed: 0 };
    out.set(k, b);
    b.phone = e.counterparty_phone ?? b.phone;
    if (e.status === "DISPUTED") b.disputed += e.amount;
    else if (e.status === "PENDING_CONFIRMATION") b.waiting_my_ok += e.amount;
    else {
      b.settled += e.settled_amount;
      if (e.linked_entry_id && linked.get(e.linked_entry_id) === "PENDING_CONFIRMATION") b.waiting_their_ok += e.amount;
      if (e.kind === "UDHAAR_GIVEN") {
        b.given += e.amount;
        b.lene += open(e);
        if (open(e) && !b.remind_entry_id) b.remind_entry_id = e.id;
      } else {
        b.taken += e.amount;
        b.dene += open(e);
        if (open(e) && !b.pay_entry && e.counterparty_mid && e.linked_entry_id) b.pay_entry = { mid: e.counterparty_mid, id: e.linked_entry_id };
      }
    }
  }
  return [...out.values()].map((b) => ({ ...b, outstanding: b.lene - b.dene })).sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));
}

// The days from..to (IST, inclusive): UPI from Paytm's ledger next to the self-reported khata.
export async function khataPeriod(merchant_id: string, from = istDay(), to = from) {
  const dates = { gte: entryDate(from), lte: entryDate(to) };
  const [upi, entries, settled, balances] = await Promise.all([
    db.payment.aggregate({ where: { merchant_id, status: "SUCCESS", created_at: range(from, to) }, _sum: { amount: true }, _count: { _all: true } }),
    db.khataEntry.findMany({ where: { merchant_id, status: "CONFIRMED", entry_date: dates }, orderBy: { created_at: "asc" } }),
    db.khataSettlement.findMany({ where: { entry: { merchant_id }, created_at: range(from, to) }, select: { amount: true, entry: { select: { kind: true } } } }),
    udhaarBalances(merchant_id),
  ]);
  const of = (k: KhataEntry["kind"]) => sum(entries.filter((e) => e.kind === k));
  const upiTotal = upi._sum.amount ?? 0;
  const cash = of("CASH_SALE");
  const expenses = of("CASH_EXPENSE");
  return {
    from,
    to,
    upi: { total: upiTotal, count: upi._count._all, source: "verified by Paytm" },
    cash: { total: cash, source: "self-reported (aapne bataya)" },
    kamai: upiTotal + cash, // "Aaj ki kamai" = UPI + cash
    expenses: { total: expenses, source: "self-reported (aapne bataya)" },
    net: upiTotal + cash - expenses,
    udhaar: {
      source: "self-reported (aapne bataya)",
      given: of("UDHAAR_GIVEN"),
      taken: of("UDHAAR_TAKEN"),
      received_back: sum(settled.filter((s) => s.entry.kind === "UDHAAR_GIVEN")),
      paid_back: sum(settled.filter((s) => s.entry.kind === "UDHAAR_TAKEN")),
      outstanding_lene: sum(balances.map((b) => ({ amount: b.lene }))),
      outstanding_dene: sum(balances.map((b) => ({ amount: b.dene }))),
    },
    entries: entries.slice(-20).map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, counterparty: e.counterparty_name, note: e.note, date: e.entry_date.toISOString().slice(0, 10) })),
  };
}
