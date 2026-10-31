// Ledger-writing helpers shared by the injectors. Shapes and clock mirror prisma/seed.ts.
// Neon over HTTP, not Prisma: Neon sits ~250 ms away, and an interactive Prisma transaction pays
// that per statement (15+ s for rent_after_return). Here an injection is one read batch plus one
// write batch, each a single round trip, and the write batch is one Postgres transaction.
import { randomInt, randomUUID } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | undefined;
export const sql = () => (_sql ??= neon(process.env.DATABASE_URL!));

export const DAY = 86_400_000;
export const IST = 5.5 * 3_600_000;
export const today = () => Math.floor((Date.now() + IST) / DAY) * DAY; // IST calendar day, as UTC midnight
export const at = (d: number, h: number) => new Date(d - IST + h * 3_600_000); // h o'clock IST on day d
export const periodOf = (d: number) => new Date(d).toISOString().slice(0, 7);
export const monthStart = (p: string) => Date.parse(`${p}-01T00:00:00Z`);
export const nextPeriod = (p: string) => periodOf(monthStart(p) + 32 * DAY);
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
// The last n billing periods already started, oldest first.
export function lastPeriods(n: number) {
  const t = today(), out: string[] = [];
  for (let p = periodOf(t); out.length < n; p = periodOf(monthStart(p) - DAY)) if (monthStart(p) < t) out.unshift(p);
  return out;
}

const pick = <T>(xs: readonly T[]) => xs[randomInt(xs.length)];
const NAMES = ["rahul", "priya", "amit", "sneha", "vikas", "pooja", "rohit", "anjali", "manish", "kavya"];
const HANDLES = ["okhdfcbank", "ybl", "paytm", "okaxis", "oksbi", "ibl", "okicici"];
export const COURIERS = ["Delhivery", "Blue Dart", "Ekart", "Shadowfax"];
export const courier = () => pick(COURIERS);
export const customerVpa = () => `${pick(NAMES)}${randomInt(10, 9999)}@${pick(HANDLES)}`;
// Seed RRNs sit in 61xxxxxxxxxx; injected ones in 64xxxxxxxxxx so they can never collide.
export const txnRef = () => String(640_000_000_000 + randomInt(0, 9_999_999_999));
export const orderRef = () => `ORD-${randomInt(36 ** 5, 36 ** 6).toString(36).toUpperCase()}`;

// ---------- read: everything an injector needs about one merchant, in one round trip ----------

export type Settlement = { id: string; date: string; day: number; gross: number; deductions_total: number };
export type Sub = { id: string; device_id: string; monthly_rent: number; status: string };
export type Charge = { id: string; subscription_id: string; period: string; kind: string; amount: number; status: string; deducted_in_settlement_id: string | null };
export type Deduction = { id: string; settlement_id: string; type: string; amount: number; source_ref: string | null };
export type Device = { id: string; serial: string; model: string; last_seen_at: string; events: string[] };
export type Loan = { id: string; principal: number; outstanding: number; status: string; settlement_offer_amount: number | null };
export type Ctx = { mid: string; settlements: Settlement[]; subs: Sub[]; charges: Charge[]; deductions: Deduction[]; devices: Device[]; loans: Loan[] };

export async function load(mid: string): Promise<Ctx> {
  const s = sql();
  const [settlements, subs, charges, deductions, devices, loans] = (await s.transaction([
    s.query(`SELECT id, date::text date, gross, deductions_total FROM settlement.settlements WHERE merchant_id = $1 ORDER BY date`, [mid]),
    s.query(`SELECT id, device_id, monthly_rent, status::text status FROM billing.subscriptions WHERE merchant_id = $1 ORDER BY started_at`, [mid]),
    s.query(`SELECT id, subscription_id, period, kind::text kind, amount, status::text status, deducted_in_settlement_id FROM billing.charges WHERE merchant_id = $1 ORDER BY period`, [mid]),
    s.query(`SELECT id, settlement_id, type::text type, amount, source_ref FROM settlement.deductions WHERE merchant_id = $1`, [mid]),
    s.query(`SELECT d.id, d.serial, d.model::text model, d.last_seen_at::text last_seen_at,
               coalesce(json_agg(e.type ORDER BY e.at) FILTER (WHERE e.id IS NOT NULL), '[]') events
             FROM logistics.devices d LEFT JOIN logistics.device_events e ON e.device_id = d.id
             WHERE d.merchant_id = $1 GROUP BY d.id`, [mid]),
    s.query(`SELECT id, principal, outstanding, status::text status, settlement_offer_amount FROM lending.loans WHERE merchant_id = $1`, [mid]),
  ], { readOnly: true })) as any[][];
  if (!settlements.length) throw new Error(`unknown merchant ${mid}`);
  for (const x of settlements) x.day = Date.parse(`${x.date}T00:00:00Z`);
  return { mid, settlements, subs, charges, deductions, devices, loans };
}

// The latest settlement that can absorb `need` without going negative (a payout is never below zero).
// The newest real payment across all merchants ('@demo' VPAs are pay-page tests): "now" for the market.
export const MARKET_NOW = `(SELECT max(created_at) FROM settlement.payments WHERE status = 'SUCCESS' AND payer_vpa NOT LIKE '%@demo')`;

// Each merchant's average SUCCESS payments per day in the 2 h before market-now, over the previous 7 days.
export const BUSY_AVG = `SELECT p.merchant_id, count(*) / 7.0 avg FROM settlement.payments p, generate_series(1, 7) k, (SELECT ${MARKET_NOW} g) m
  WHERE p.status = 'SUCCESS' AND p.created_at > m.g - k * interval '1 day' - interval '2 hours' AND p.created_at <= m.g - k * interval '1 day'
  GROUP BY p.merchant_id`;
export const BUSY_MIN = 6; // payments_stopped needs this many, so chance gaps don't look like a swapped QR

export const latest = (c: Ctx, need = 0) =>
  c.settlements.findLast((x) => x.gross - x.deductions_total >= need) ?? c.settlements[c.settlements.length - 1];
export function settlementOnOrAfter(c: Ctx, d: number) {
  const s = c.settlements.find((x) => x.day >= d);
  if (!s) throw new Error(`no settlement on or after ${new Date(d).toISOString().slice(0, 10)} for ${c.mid}`);
  return s;
}
export const rentCharges = (c: Ctx, subscription_id: string, take: number) =>
  c.charges.filter((x) => x.subscription_id === subscription_id && x.kind === "RENT" && x.status === "DEDUCTED").slice(-take);

// ---------- write: buffered, then sent as one transaction ----------

type Row = Record<string, unknown>;
// Parent tables first: foreign keys are checked statement by statement.
const ORDER = ["logistics.devices", "logistics.device_events", "billing.subscriptions", "billing.charges", "settlement.payments", "disputes.disputes", "lending.loans", "lending.loan_payments", "settlement.deductions", "hisaab.injections"];
// Timestamps are stored as UTC in `timestamp without time zone` (Prisma's convention); pg's own
// Date encoding would write local time with an offset that Postgres then drops.
const val = (v: unknown) => (v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export class Plan {
  private rows = new Map<string, Row[]>();
  private after: { text: string; params: unknown[] }[] = [];
  private adj = new Map<string, { gross: number; ded: number }>();
  readonly injection_id = randomUUID(); // known up front so rows can point at it
  constructor(public ctx: Ctx) {}

  insert<T extends Row>(table: string, row: T): T & { id: string } {
    const r = { id: randomUUID(), ...row };
    this.rows.set(table, [...(this.rows.get(table) ?? []), r]);
    return r;
  }
  update(table: string, id: string, set: Row) {
    const cols = Object.keys(set);
    this.after.push({ text: `UPDATE ${table} SET ${cols.map((k, i) => `"${k}" = $${i + 2}`).join(", ")} WHERE id = $1`, params: [id, ...cols.map((k) => val(set[k]))] });
  }
  raw(text: string, params: unknown[]) {
    this.after.push({ text, params });
  }
  // Settlement totals move by delta, so concurrent injections on one merchant still add up.
  settle(id: string, { gross = 0, ded = 0 }) {
    const a = this.adj.get(id) ?? { gross: 0, ded: 0 };
    this.adj.set(id, { gross: a.gross + gross, ded: a.ded + ded });
  }
  deduct(s: Settlement, type: string, amount: number, source_ref: string | null) {
    this.settle(s.id, { ded: amount });
    const d = this.insert("settlement.deductions", { settlement_id: s.id, merchant_id: this.ctx.mid, type, amount, source_ref, created_at: at(s.day, 6) });
    this.ctx.deductions.push(d as unknown as Deduction);
    return d;
  }
  // Re-home a charge's deduction into another settlement (same row, so no duplicate source_ref).
  moveChargeDeduction(charge: Charge, to: Settlement) {
    if (charge.deducted_in_settlement_id === to.id) return;
    const d = this.ctx.deductions.find((x) => x.source_ref === charge.id);
    if (!d) throw new Error(`no deduction for charge ${charge.id}`);
    this.update("settlement.deductions", d.id, { settlement_id: to.id, created_at: at(to.day, 6) });
    this.update("billing.charges", charge.id, { deducted_in_settlement_id: to.id });
    this.settle(d.settlement_id, { ded: -d.amount });
    this.settle(to.id, { ded: d.amount });
    d.settlement_id = charge.deducted_in_settlement_id = to.id;
  }

  async commit() {
    const s = sql(), qs = [];
    for (const table of ORDER) {
      const rows = this.rows.get(table);
      if (!rows?.length) continue;
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))], params: unknown[] = [];
      const tuples = rows.map((r) => `(${cols.map((c) => (params.push(val(r[c] ?? null)), `$${params.length}`)).join(", ")})`);
      qs.push(s.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`, params));
    }
    for (const u of this.after) qs.push(s.query(u.text, u.params));
    for (const [id, { gross, ded }] of this.adj)
      if (gross || ded) qs.push(s.query(`UPDATE settlement.settlements SET gross = gross + $2, deductions_total = deductions_total + $3, net = net + $2 - $3 WHERE id = $1`, [id, gross, ded]));
    await s.transaction(qs);
  }
}

// A new Soundbox on rent for the last `months` periods, each deducted from the first settlement
// of its month, exactly like the seed. delivered=false is the ghost device.
export function addSoundbox(p: Plan, months: number, delivered: boolean) {
  const c = p.ctx, periods = lastPeriods(months), by = courier();
  const dispatched = at(monthStart(periods[0]) - 6 * DAY, 11), deliveredAt = new Date(dispatched.getTime() + 2 * DAY);
  const device = p.insert("logistics.devices", {
    serial: `SB${2_500_000_000 + randomInt(0, 99_999_999)}`, model: "SOUNDBOX", merchant_id: c.mid,
    last_seen_at: delivered ? new Date(Date.now() - randomInt(1, 5) * 60_000) : dispatched,
  });
  p.insert("logistics.device_events", { device_id: device.id, type: "DISPATCHED", at: dispatched, actor: by });
  if (delivered) p.insert("logistics.device_events", { device_id: device.id, type: "DELIVERED", at: deliveredAt, actor: by });
  const sub = p.insert("billing.subscriptions", { merchant_id: c.mid, device_id: device.id, plan: "Soundbox", monthly_rent: 135, status: "ACTIVE", started_at: delivered ? deliveredAt : dispatched });
  const charges = periods.map((period) => {
    const s = settlementOnOrAfter(c, monthStart(period));
    const ch = p.insert("billing.charges", { subscription_id: sub.id, merchant_id: c.mid, period, kind: "RENT", amount: 135, status: "DEDUCTED", deducted_in_settlement_id: s.id });
    p.deduct(s, "RENT", ch.amount, ch.id);
    return ch;
  });
  c.subs.push(sub);
  c.devices.push({ ...device, last_seen_at: device.last_seen_at.toISOString(), events: delivered ? ["DISPATCHED", "DELIVERED"] : ["DISPATCHED"] });
  c.charges.push(...charges);
  return { device, sub, charges };
}

// An ACTIVE Soundbox subscription with a delivered device and no return or pickup history,
// so a new injection doesn't overlap an earlier one. Adds a fresh Soundbox if none is left.
export function cleanSoundbox(p: Plan) {
  const c = p.ctx;
  for (const sub of c.subs) {
    const device = c.devices.find((d) => d.id === sub.device_id);
    if (sub.status !== "ACTIVE" || device?.model !== "SOUNDBOX" || !isLive(device)) continue;
    if (c.charges.some((x) => x.subscription_id === sub.id && x.status === "BILLED")) continue;
    return { sub, device: device as { id: string; serial: string } };
  }
  return addSoundbox(p, 5, true);
}

export const isLive = (d: Device) => d.events.includes("DELIVERED") && !d.events.some((t) => t === "PICKUP_REQUESTED" || t === "PICKED_UP" || t === "RECEIVED_AT_WAREHOUSE");
