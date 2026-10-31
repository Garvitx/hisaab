// Shared by the CLI (scripts/inject.ts), the panel (POST /api/inject) and the demo script.
import { randomInt } from "node:crypto";
import { BUSY_AVG, BUSY_MIN, Plan, load, sql } from "./lib";
import type { Injector } from "./anomalies";
import * as A from "./anomalies";
import * as D from "./decoys";
import { WAREHOUSES, warehouseBug } from "./warehouse-bug";

type Entry = { run: Injector; label: string; amount?: number; options?: string[] };

export const ANOMALIES: Record<string, Entry> = {
  rent_after_return: { run: A.rent_after_return, label: "Rent after return", amount: 594 },
  ghost_device: { run: A.ghost_device, label: "Ghost device", amount: 405 },
  silent_deduction: { run: A.silent_deduction, label: "Silent deduction", amount: 2800 },
  orphan_dispute: { run: A.orphan_dispute, label: "Orphan dispute", amount: 1850 },
  zombie_loan: { run: A.zombie_loan, label: "Zombie loan" },
  duplicate_deduction: { run: A.duplicate_deduction, label: "Duplicate deduction", amount: 135 },
  deduction_without_source: { run: A.deduction_without_source, label: "Deduction without source", amount: 299 },
  device_offline: { run: A.device_offline, label: "Soundbox offline" },
  pending_payment: { run: A.pending_payment, label: "Pending payment", amount: 500, options: ["failed"] },
  pickup_never_completed: { run: A.pickup_never_completed, label: "Pickup never completed", amount: 270 },
  velocity_burst: { run: A.velocity_burst, label: "Card-testing burst", amount: 23 },
  qr_swapped: { run: A.qr_swapped, label: "QR swapped, payments stopped" },
};

export const DECOYS: Record<string, Entry> = {
  legit_late_fee: { run: D.legit_late_fee, label: "Legit late fee", amount: 54 },
  merchant_refund: { run: D.merchant_refund, label: "Merchant refund", amount: 500 },
  slow_day: { run: D.slow_day, label: "Slow Sunday" },
};

export const catalog = () => {
  const list = (r: Record<string, Entry>) => Object.entries(r).map(([type, { label, amount, options }]) => ({ type, label, amount: amount ?? null, options: options ?? [] }));
  // warehouse_bug ignores the target: it always picks `count` unclaimed non-demo shops.
  const multi = { type: "warehouse_bug", label: "Warehouse bug (many shops)", amount: null, options: [], params: { count: { default: 5, min: 1, max: 10 }, location: { default: "NOIDA-2", choices: [...WAREHOUSES] } } };
  return { types: [...list(ANOMALIES), multi], decoys: list(DECOYS), targets: ["demo", "random", "MID-xxxx"] };
};

// demo → MID-0001; MID-xxxx → that merchant; random → a non-demo merchant not injected yet
// (zombie_loan prefers one with a live loan; the injector books a loan otherwise).
async function resolveTarget(type: string, target: string) {
  if (target === "demo") return "MID-0001";
  if (target !== "random") {
    if (!/^MID-\d{4}$/.test(target)) throw new Error(`unknown merchant ${target}`);
    return target; // load() rejects one that doesn't exist
  }
  const rows = (await sql().query(
    `SELECT m.id,
       EXISTS (SELECT 1 FROM lending.loans l WHERE l.merchant_id = m.id AND l.status = 'ACTIVE' AND l.settlement_offer_amount IS NULL) has_loan,
       EXISTS (SELECT 1 FROM hisaab.injections i WHERE i.merchant_id = m.id) used
     FROM merchants.merchants m WHERE NOT m.is_demo`,
  )) as { id: string; has_loan: boolean; used: boolean }[];
  let pool = rows;
  if (type === "zombie_loan" && pool.some((m) => m.has_loan)) pool = pool.filter((m) => m.has_loan);
  if (type === "qr_swapped") {
    const busy = new Set(((await sql().query(`SELECT merchant_id FROM (${BUSY_AVG}) b WHERE avg >= $1`, [BUSY_MIN])) as { merchant_id: string }[]).map((r) => r.merchant_id));
    pool = pool.filter((m) => busy.has(m.id));
    if (!pool.length) throw new Error(`qr_swapped: no merchant averages ${BUSY_MIN}+ payments at this hour`);
  }
  if (pool.some((m) => !m.used)) pool = pool.filter((m) => !m.used);
  return pool[randomInt(pool.length)].id;
}

export async function inject(type: string, target: string, opts: { decoy?: boolean; failed?: boolean; count?: number; location?: string } = {}) {
  if (type === "warehouse_bug" && !opts.decoy) return warehouseBug(opts);
  const entry = (opts.decoy ? DECOYS : { ...ANOMALIES, ...DECOYS })[type];
  if (!entry) throw new Error(`unknown ${opts.decoy ? "decoy" : "type"} ${type}`);
  const merchant_id = await resolveTarget(type, target);
  const plan = new Plan(await load(merchant_id));
  const { summary, params } = await entry.run(plan, { failed: opts.failed });
  const row = plan.insert("hisaab.injections", { id: plan.injection_id, type, merchant_id, is_decoy: type in DECOYS, params });
  // One transaction: the watcher must never see half an injection.
  await plan.commit();
  return { injection_id: row.id, merchant_id, summary };
}
