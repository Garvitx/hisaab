// warehouse_bug: one warehouse's return scan never reaches billing, so every Soundbox it received
// since 13 June 2026 kept renting. Hits N shops at once, which is what the root-cause finder groups.
// Unlike the other injectors this writes through src/systems/* (not one raw SQL batch), so enabled
// guard rules apply to it exactly as they would to Paytm's own billing run.
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { activeDemoMid } from "@/lib/demo";
import * as billing from "@/systems/billing";
import * as logistics from "@/systems/logistics";
import * as settlement from "@/systems/settlement";
import { DAY, at, courier, monthStart, nextPeriod, periodOf, rupees, today } from "./lib";

export const WAREHOUSES = ["NOIDA-2", "GGN-1", "DEL-3", "GZB-1", "FBD-1"] as const;
const BUG_FROM = Date.UTC(2026, 5, 13); // first return the bug ate
const LATE_FEE = 18;
const RENT = 135;
const day = (d: Date) => d.toISOString().slice(0, 10);

// Non-demo shops nobody has claimed on WhatsApp and the demo phone is not acting as, fresh ones first.
async function targets(n: number) {
  const acting = await activeDemoMid();
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT m.id FROM merchants.merchants m
    WHERE NOT m.is_demo AND m.id <> ${acting} AND NOT EXISTS (SELECT 1 FROM hisaab.phone_bindings b WHERE b.merchant_id = m.id)
    ORDER BY EXISTS (SELECT 1 FROM hisaab.injections i WHERE i.merchant_id = m.id), random()
    LIMIT ${n}`;
  if (rows.length < n) throw new Error(`warehouse_bug: only ${rows.length} unclaimed non-demo merchants`);
  return rows.map((r) => r.id);
}

// ponytail: sequential awaits, not one transaction. Each write is ~200 ms apart, well inside the
// watcher's 1.5 s settle time; a stall longer than that could let detection see half an injection.
async function one(merchant_id: string, location: string) {
  const t = today();
  const received = at(BUG_FROM + randomInt(0, 80) * DAY, randomInt(10, 18));
  const picked = new Date(received.getTime() - randomInt(1, 3) * DAY);
  const dispatched = at(received.getTime() - randomInt(90, 200) * DAY, 11), delivered = new Date(dispatched.getTime() + 2 * DAY);
  const periods: string[] = [];
  for (let p = nextPeriod(periodOf(received.getTime())); monthStart(p) < t; p = nextPeriod(p)) periods.push(p);
  const fees = randomInt(1, periods.length + 1); // the oldest rents also ran late
  const need = periods.length * RENT + fees * LATE_FEE;
  const sets = await settlement.settlements(merchant_id, new Date(t - 21 * DAY));
  const s = sets.findLast((x) => x.gross - x.deductions_total >= need) ?? sets.at(-1);
  if (!s) throw new Error(`warehouse_bug: ${merchant_id} has no recent settlement`);

  const inj = await db.injection.create({ data: { type: "warehouse_bug", merchant_id, params: { location } } });
  const by = courier(), agent = `FA-${randomInt(1000, 9999)}`;
  const device = await logistics.addDevice({ serial: `SB${2_600_000_000 + randomInt(0, 99_999_999)}`, model: "SOUNDBOX", merchant_id, last_seen_at: picked });
  await logistics.addEvent(device.id, "DISPATCHED", by, dispatched);
  await logistics.addEvent(device.id, "DELIVERED", by, delivered);
  await logistics.addEvent(device.id, "PICKED_UP", agent, picked, location);
  await logistics.addEvent(device.id, "RECEIVED_AT_WAREHOUSE", agent, received, location);
  const sub = await billing.addSubscription({ merchant_id, device_id: device.id, plan: "Soundbox", monthly_rent: RENT, started_at: delivered });

  const charges = [];
  for (const [i, period] of periods.entries())
    for (const [kind, amount] of [["RENT", RENT], ...(i < fees ? [["LATE_FEE", LATE_FEE]] : [])] as ["RENT" | "LATE_FEE", number][]) {
      const ch = await billing.addCharge({ subscription_id: sub.id, merchant_id, period, kind, amount, status: "DEDUCTED", deducted_in_settlement_id: s.id });
      if (ch.status !== "BLOCKED") await settlement.addDeduction({ settlement_id: s.id, merchant_id, type: kind, amount, source_ref: ch.id, created_at: at(s.date.getTime(), 6) });
      charges.push(ch);
    }
  const deducted = charges.filter((c) => c.status !== "BLOCKED"), blocked = charges.length - deducted.length;
  const amount = deducted.reduce((a, c) => a + c.amount, 0);
  const params = { location, amount, device_id: device.id, subscription_id: sub.id, settlement_id: s.id, charge_ids: charges.map((c) => c.id), blocked };
  await db.injection.update({ where: { id: inj.id }, data: { params } });
  return {
    injection_id: inj.id, merchant_id,
    summary: `${device.serial} received at ${location} ${day(received)}, ${periods.length} rents + ${fees} late fees${blocked ? `, ${blocked} blocked by guard` : ""}, ${rupees(amount)} deducted on ${day(s.date)}`,
  };
}

export async function warehouseBug(opts: { count?: number; location?: string } = {}) {
  const count = Math.max(1, Math.min(10, Math.floor(opts.count ?? 5)));
  const location = opts.location ?? "NOIDA-2";
  if (!(WAREHOUSES as readonly string[]).includes(location)) throw new Error(`unknown location ${location} (${WAREHOUSES.join(", ")})`);
  const results = await Promise.all((await targets(count)).map((mid) => one(mid, location)));
  return {
    injection_id: results[0].injection_id,
    merchant_id: results.map((r) => r.merchant_id).join(", "),
    summary: results.map((r) => `${r.merchant_id}: ${r.summary}`).join("; "),
    results,
  };
}
