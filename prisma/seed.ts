// Run: pnpm db:seed (expects an empty DB; pnpm demo:reset truncates first).
// Deterministic for a given day: one seeded PRNG drives every choice, dates are relative to now.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
const HISTORY_FROM = Date.UTC(2026, 4, 1);
const CHUNK = 5000;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20261031;
let rand = mulberry32(SEED); // reset per call: the inject API reseeds inside one long-lived process
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const logUniform = (lo: number, hi: number) => Math.round(Math.exp(Math.log(lo) + rand() * Math.log(hi / lo)));
const ymd = (d: number) => new Date(d).toISOString().slice(0, 10);
const digits = (s?: string) => String(s ?? "").replace(/\D/g, "");

// [business, owner, city, segment, language]. MID = index + 1.
const MERCHANTS = [
  ["Ramesh Kirana Store", "Ramesh Kumar", "Noida", "kirana", "hinglish"],
  ["Sharma Medical Hall", "Anil Sharma", "Delhi", "medical", "hi"],
  ["Bikaner Sweets Corner", "Mahesh Agarwal", "Delhi", "sweets", "hinglish"],
  ["Ali Mobile Centre", "Mohammad Ali", "Ghaziabad", "mobile shop", "hinglish"],
  ["Gupta General Store", "Suresh Gupta", "Faridabad", "kirana", "hi"],
  ["Spice Route Dhaba", "Harpreet Singh", "Gurugram", "restaurant", "en"],
  ["Glamour Unisex Salon", "Neha Verma", "Noida", "salon", "en"],
  ["Saraswati Stationers", "Rajesh Jain", "Delhi", "stationery", "hi"],
  ["CarePlus Chemist", "Vikram Malhotra", "Gurugram", "medical", "en"],
  ["Shree Ganesh Mishthan Bhandar", "Ramprakash Yadav", "Ghaziabad", "sweets", "hi"],
  ["Kumar Provision Store", "Sunil Kumar", "Delhi", "kirana", "hinglish"],
  ["Mehta Mobile Point", "Arjun Mehta", "Noida", "mobile shop", "hinglish"],
  ["Punjabi Tadka Restaurant", "Gurpreet Kaur", "Faridabad", "restaurant", "hinglish"],
  ["Style Studio Salon", "Imran Khan", "Delhi", "salon", "hinglish"],
  ["Om Sai Kirana", "Dinesh Chauhan", "Ghaziabad", "kirana", "hi"],
  ["Wellness Medicos", "Priya Nair", "Noida", "medical", "en"],
  ["Agarwal Sweets", "Pankaj Agarwal", "Gurugram", "sweets", "hinglish"],
  ["Vidya Book Depot", "Manoj Tiwari", "Faridabad", "stationery", "hinglish"],
  ["Yadav Dairy & Kirana", "Ravi Yadav", "Gurugram", "kirana", "hinglish"],
  ["Bansal Mobile World", "Rohit Bansal", "Delhi", "mobile shop", "en"],
  ["Chaudhary Family Restaurant", "Satish Chaudhary", "Ghaziabad", "restaurant", "hi"],
  ["Looks Hair & Beauty", "Pooja Saxena", "Gurugram", "salon", "hinglish"],
  ["Life Care Pharmacy", "Deepak Arora", "Faridabad", "medical", "hinglish"],
  ["Mittal Kirana Bhandar", "Ashok Mittal", "Noida", "kirana", "hi"],
  ["Annapurna Bhojnalaya", "Kamla Devi", "Delhi", "restaurant", "hi"],
  ["Shiv Shakti Stationery", "Amit Pandey", "Ghaziabad", "stationery", "hinglish"],
  ["Rajdhani Sweets", "Naveen Khurana", "Faridabad", "sweets", "en"],
  ["Singh Telecom", "Jaspreet Singh", "Gurugram", "mobile shop", "hinglish"],
  ["Fresh Mart Kirana", "Sanjay Verma", "Delhi", "kirana", "hinglish"],
  ["Ayush Medical Store", "Kavita Rawat", "Noida", "medical", "hi"],
] as const;

// payments/day range and ticket size per segment
const SEGMENT: Record<string, { n: [number, number]; amt: [number, number] }> = {
  kirana: { n: [30, 45], amt: [20, 1500] },
  medical: { n: [25, 40], amt: [40, 2000] },
  sweets: { n: [22, 38], amt: [50, 2000] },
  "mobile shop": { n: [8, 18], amt: [100, 2000] },
  restaurant: { n: [28, 45], amt: [80, 2000] },
  salon: { n: [8, 18], amt: [100, 2000] },
  stationery: { n: [10, 22], amt: [20, 800] },
};
const WEEKDAY = [0.85, 1, 0.95, 1, 1, 1.1, 1.25]; // Sun..Sat
const EDC_MIDS = [6, 9, 20];
const LOAN_MIDS = [3, 5, 11, 13, 21, 29];
const DISPUTES: [number, "WON" | "LOST"][] = [[2, "WON"], [12, "LOST"], [17, "WON"], [25, "LOST"]];
const HANDLES = ["okhdfcbank", "ybl", "paytm", "okaxis", "oksbi", "ibl", "okicici"];
const PAYERS = ["rahul", "priya", "amit", "sneha", "vikas", "pooja", "rohit", "anjali", "manish", "kavya", "deepak", "neha", "sachin", "ritu", "arun", "simran", "karan", "meena", "ajay", "sunita"];
const COURIERS = ["Delhivery", "Blue Dart", "Ekart", "Shadowfax"];

export async function main() {
  rand = mulberry32(SEED);
  const t0 = Date.now();
  const demoPhone = process.env.DEMO_MERCHANT_PHONE;
  if (!demoPhone?.startsWith("+")) throw new Error("DEMO_MERCHANT_PHONE must be set (E.164 with +)");
  // Dynamic import: db.ts reads DATABASE_URL at load, which must happen after dotenv.
  const { db } = await import("../src/lib/db");

  const now = Date.now();
  const today = Math.floor((now + IST) / DAY) * DAY; // IST calendar day, as UTC midnight
  const payFrom = today - 31 * DAY;

  const merchants: any[] = [], devices: any[] = [], events: any[] = [], subs: any[] = [], charges: any[] = [];
  const payments: any[] = [], settlements: any[] = [], deductions: any[] = [], loans: any[] = [], loanPayments: any[] = [], disputes: any[] = [];
  const used = new Set([digits(demoPhone), digits(process.env.OPS_EMPLOYEE_PHONE)]);
  let txn = 0, serial = 0;

  const payment = (mid: string, at: number, amt: [number, number], status: string) => {
    const p = {
      id: randomUUID(), merchant_id: mid,
      txn_ref: String(610000000000 + ++txn * 97 + int(0, 96)), // 12-digit UPI RRN, unique by construction
      amount: logUniform(...amt),
      payer_vpa: `${pick(PAYERS)}${int(10, 9999)}@${pick(HANDLES)}`,
      order_ref: rand() < 0.9 ? `ORD-${(txn * 7919).toString(36).toUpperCase().padStart(6, "0")}` : null,
      status, created_at: new Date(at),
    };
    payments.push(p);
    return p;
  };
  const dayTime = (d: number) => d - IST + 8 * 3_600_000 + Math.floor(rand() * 14 * 3_600_000); // 08:00-22:00 IST

  for (const [i, [business_name, owner_name, city, segment, language]] of MERCHANTS.entries()) {
    const n = i + 1, mid = `MID-${String(n).padStart(4, "0")}`, seg = SEGMENT[segment];
    let phone = demoPhone;
    if (n > 1) {
      do phone = `+91${pick(["9", "8", "7"])}${String(int(0, 999_999_999)).padStart(9, "0")}`; while (used.has(digits(phone)));
      used.add(digits(phone));
    }
    const onboarded = Date.UTC(2025, 5, 1) + int(0, 280) * DAY + 5 * 3_600_000; // Jun 2025 to Mar 2026
    merchants.push({ id: mid, business_name, owner_name, phone, city, language, segment, onboarded_at: new Date(onboarded), is_demo: n === 1 });

    for (const [model, plan, rent] of [["SOUNDBOX", "Soundbox", 135], ...(EDC_MIDS.includes(n) ? [["EDC", "EDC", 249]] : [])] as const) {
      const device = { id: randomUUID(), serial: `${model === "EDC" ? "EDC" : "SB"}${String(24000000 + ++serial * 131).padStart(10, "0")}`, model, merchant_id: mid, last_seen_at: new Date(now - int(1, 5) * 60_000) };
      const dispatched = onboarded + int(1, 3) * DAY, delivered = dispatched + int(1, 4) * DAY;
      const courier = pick(COURIERS);
      devices.push(device);
      events.push({ id: randomUUID(), device_id: device.id, type: "DISPATCHED", at: new Date(dispatched), actor: courier },
        { id: randomUUID(), device_id: device.id, type: "DELIVERED", at: new Date(delivered), actor: courier });
      subs.push({ id: randomUUID(), merchant_id: mid, device_id: device.id, plan, monthly_rent: rent, status: "ACTIVE", started_at: new Date(delivered) });
    }

    // Payments for the window; settlement D pays out the SUCCESS payments of D-1.
    const base = int(...seg.n), meanAmt = (seg.amt[1] - seg.amt[0]) / Math.log(seg.amt[1] / seg.amt[0]);
    const grossOf = new Map<number, number>();
    for (let d = payFrom; d <= today; d += DAY) {
      let sum = 0;
      const count = Math.max(5, Math.min(60, Math.round(base * WEEKDAY[new Date(d).getUTCDay()] * (0.7 + rand() * 0.6))));
      for (let k = 0; k < count; k++) {
        // Draw before filtering so the PRNG stream doesn't depend on the time of day.
        const at = dayTime(d), r = rand(), p = payment(mid, at, seg.amt, r < 0.03 ? "FAILED" : r < 0.05 ? "REFUNDED" : "SUCCESS");
        if (at > now - 60_000) { payments.pop(); continue; }
        if (p.status === "SUCCESS") sum += p.amount;
      }
      grossOf.set(d, sum);
    }

    const byDate = new Map<number, any>();
    // Through today: this morning's T+1 payout of yesterday's sales already exists, like on Paytm.
    for (let d = HISTORY_FROM; d <= today; d += DAY) {
      const gross = grossOf.get(d - DAY) ?? Math.round(base * meanAmt * WEEKDAY[new Date(d - DAY).getUTCDay()] * (0.75 + rand() * 0.5));
      const s = { id: randomUUID(), merchant_id: mid, date: new Date(d), gross, deductions_total: 0, net: 0, status: "SETTLED" };
      settlements.push(s);
      byDate.set(d, s);
    }
    const deduct = (d: number, type: string, amount: number, source_ref: string) => {
      const s = byDate.get(d);
      deductions.push({ id: randomUUID(), settlement_id: s.id, merchant_id: mid, type, amount, source_ref, created_at: new Date(d - IST + 6 * 3_600_000) });
      s.deductions_total += amount;
    };
    const months = [4, 5, 6, 7, 8, 9].map((m) => Date.UTC(2026, m, 1)).filter((d) => d < today);

    for (const sub of subs.filter((s) => s.merchant_id === mid))
      for (const d of months) {
        const c = { id: randomUUID(), subscription_id: sub.id, merchant_id: mid, period: ymd(d).slice(0, 7), kind: "RENT", amount: sub.monthly_rent, status: "DEDUCTED", deducted_in_settlement_id: byDate.get(d).id };
        charges.push(c);
        deduct(d, "RENT", c.amount, c.id);
      }

    if (LOAN_MIDS.includes(n)) {
      const principal = pick([24000, 30000, 36000, 48000]), emi = principal / 12;
      const loan = { id: randomUUID(), merchant_id: mid, principal, outstanding: principal, status: "ACTIVE", settlement_offer_amount: null };
      for (const d of months.map((m) => m + 4 * DAY).filter((d) => d < today)) {
        // source_ref is the loan_payment id, not the loan id: a loan id repeated monthly would trip duplicate_deduction.
        const lp = { id: randomUUID(), loan_id: loan.id, amount: emi, kind: "EMI", at: new Date(d - IST + 6 * 3_600_000) };
        loanPayments.push(lp);
        deduct(d, "LOAN_EMI", emi, lp.id);
        loan.outstanding -= emi;
      }
      loans.push(loan);
    }

    const dispute = DISPUTES.find(([m]) => m === n);
    if (dispute) {
      // Old payment (45-90 days back), before the detailed payments window, so it only lives in this row.
      const d = today - int(45, 90) * DAY, p = payment(mid, dayTime(d), seg.amt, "SUCCESS");
      p.order_ref ??= `ORD-${(txn * 7919).toString(36).toUpperCase().padStart(6, "0")}`;
      const won = dispute[1] === "WON", raised = d + 3 * DAY;
      const row = {
        id: randomUUID(), merchant_id: mid, payment_id: p.id, amount: p.amount, raised_by_vpa: p.payer_vpa,
        reason: won ? "Customer says goods not received" : "Customer says amount debited twice",
        status: dispute[1], merchant_contested: won, response_due_at: new Date(raised + 7 * DAY),
        deducted_at: won ? null : new Date(raised + 7 * DAY + 3_600_000),
        response_text: won ? `Bill for ${p.order_ref} signed by customer at pickup.` : null,
      };
      disputes.push(row);
      if (!won) deduct(raised + 8 * DAY, "DISPUTE", row.amount, row.id);
    }
    for (const s of byDate.values()) s.net = s.gross - s.deductions_total;
  }

  const insert = async (model: any, rows: any[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) await model.createMany({ data: rows.slice(i, i + CHUNK) });
  };
  await insert(db.merchant, merchants);
  await insert(db.device, devices);
  await Promise.all([
    insert(db.deviceEvent, events),
    insert(db.subscription, subs).then(() => insert(db.charge, charges)),
    insert(db.settlement, settlements).then(() => insert(db.deduction, deductions)),
    insert(db.payment, payments).then(() => insert(db.dispute, disputes)),
    insert(db.loan, loans).then(() => insert(db.loanPayment, loanPayments)),
    db.policy.upsert({ where: { id: 1 }, create: { id: 1, auto_limit: 1000, approval_limit: 5000, lending_always_escalate: true }, update: { auto_limit: 1000, approval_limit: 5000, lending_always_escalate: true } }),
  ]);
  // The triggers logged every seed row; the watcher must start from zero.
  await db.$executeRawUnsafe("TRUNCATE hisaab.outbox_events RESTART IDENTITY");

  const one = async (sql: string) => Number(((await db.$queryRawUnsafe(sql)) as any[])[0].n);
  assert.equal(await db.merchant.count(), 30);
  assert.equal(await one(`SELECT count(*) n FROM merchants.merchants WHERE is_demo`), 1);
  assert.equal((await db.merchant.findUnique({ where: { id: "MID-0001" } }))?.is_demo, true);
  assert.equal(await one(`SELECT count(*) n FROM settlement.settlements WHERE net <> gross - deductions_total OR net < 0`), 0, "net = gross - deductions_total, never negative");
  assert.equal(await one(`SELECT count(*) n FROM settlement.settlements s WHERE deductions_total <> (SELECT coalesce(sum(amount), 0) FROM settlement.deductions WHERE settlement_id = s.id)`), 0, "deductions_total = sum of deductions");
  assert.equal(await one(`SELECT count(*) n FROM billing.charges WHERE status = 'BILLED'`), 0);
  assert.equal(await one(`SELECT count(*) n FROM logistics.devices d WHERE NOT EXISTS (SELECT 1 FROM logistics.device_events e WHERE e.device_id = d.id AND e.type = 'DELIVERED')`), 0, "every device delivered");
  assert.equal(await one(`SELECT count(*) n FROM (SELECT source_ref FROM settlement.deductions WHERE source_ref IS NOT NULL GROUP BY source_ref HAVING count(*) > 1) x`), 0, "no source_ref deducted twice");
  assert.equal(await one(`SELECT count(*) n FROM settlement.deductions WHERE source_ref IS NULL`), 0);
  assert.equal(await one(`SELECT count(*) n FROM hisaab.outbox_events`), 0);

  console.log(Object.fromEntries(Object.entries({ merchants, devices, events, subs, charges, payments, settlements, deductions, loans, loanPayments, disputes }).map(([k, v]) => [k, v.length])));
  console.log(`seed ok in ${Date.now() - t0} ms`);
}

if (process.argv[1]?.endsWith("seed.ts")) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
