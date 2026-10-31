// Khata seed, called at the end of prisma/seed.ts: 8 merchants (never MID-0001, Ramesh starts empty)
// with 4 days of cash sales and expenses, customer udhaar, and 3 confirmed inter-merchant udhaar
// links. Deterministic (fixed amounts, ids prefixed khseed-), one createMany.
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const MIDS = ["MID-0002", "MID-0003", "MID-0004", "MID-0005", "MID-0006", "MID-0007", "MID-0008", "MID-0009"];
const CUSTOMERS = ["Priya Sharma", "Mohan Lal", "Sunita Devi", "Rakesh Yadav", "Anjali Verma", "Vijay Singh"];
const EXPENSES = ["doodh", "chai", "auto ka kiraya", "bijli ka bill", "saaf safai", "packing ka saman"];
const IST = 5.5 * 3_600_000;

// Linked pairs: creditor gave udhaar to debtor; both sides CONFIRMED.
const LINKS: [creditor: string, debtor: string, amount: number][] = [
  ["MID-0005", "MID-0006", 800],
  ["MID-0003", "MID-0008", 350],
  ["MID-0009", "MID-0002", 1200],
];

export async function seedKhata(): Promise<void> {
  const shops = new Map((await db.merchant.findMany({ where: { id: { in: MIDS } }, select: { id: true, business_name: true } })).map((m) => [m.id, m.business_name]));
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const day = (back: number) => new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000);
  const at = (back: number, hour: number) => new Date(day(back).getTime() - IST + hour * 3_600_000);
  const rows: Prisma.KhataEntryCreateManyInput[] = [];

  MIDS.forEach((mid, i) => {
    if (!shops.has(mid)) return;
    for (let back = 3; back >= 0; back--) {
      const n = i * 7 + back * 3; // fixed spread per shop and day, no randomness
      rows.push({ id: `khseed-${mid}-${back}-cash`, merchant_id: mid, kind: "CASH_SALE", amount: 1200 + ((n * 431) % 2800), source: back % 2 ? "WA_VOICE" : "NFC_VOICE", status: "CONFIRMED", entry_date: day(back), created_at: at(back, 20) });
      rows.push({ id: `khseed-${mid}-${back}-exp`, merchant_id: mid, kind: "CASH_EXPENSE", amount: 50 + ((n * 97) % 450), note: EXPENSES[n % EXPENSES.length], source: "NFC_VOICE", status: "CONFIRMED", entry_date: day(back), created_at: at(back, 13) });
    }
    // Two customers on credit, one partly repaid (settled_amount, no Paytm payment behind it).
    [0, 1].forEach((k) => {
      const back = k + 1;
      rows.push({ id: `khseed-${mid}-cust-${k}`, merchant_id: mid, kind: "UDHAAR_GIVEN", amount: 200 + ((i + k) * 150) % 700, counterparty_type: "CUSTOMER", counterparty_name: CUSTOMERS[(i + k * 2) % CUSTOMERS.length], note: "saman", source: "WA_TEXT", status: "CONFIRMED", settled_amount: k ? 100 : 0, entry_date: day(back), created_at: at(back, 18) });
    });
  });

  for (const [c, d, amount] of LINKS) {
    if (!shops.has(c) || !shops.has(d)) continue;
    const g = `khseed-link-${c}-${d}`;
    const t = `${g}-mirror`;
    rows.push({ id: g, merchant_id: c, kind: "UDHAAR_GIVEN", amount, counterparty_type: "MERCHANT", counterparty_name: shops.get(d), counterparty_mid: d, note: "maal", source: "NFC_VOICE", status: "CONFIRMED", linked_entry_id: t, entry_date: day(2), created_at: at(2, 11) });
    rows.push({ id: t, merchant_id: d, kind: "UDHAAR_TAKEN", amount, counterparty_type: "MERCHANT", counterparty_name: shops.get(c), counterparty_mid: c, note: "maal", source: "NFC_VOICE", status: "CONFIRMED", linked_entry_id: g, entry_date: day(2), created_at: at(2, 11) });
  }

  // Re-runnable on its own: replace only what this seed wrote.
  await db.$transaction([db.khataEntry.deleteMany({ where: { id: { startsWith: "khseed-" } } }), db.khataEntry.createMany({ data: rows })]);
}
