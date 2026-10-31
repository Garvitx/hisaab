// Run: tsx scripts/check-inject.ts. Resets the DB, injects everything, checks the ledger, runs the watcher once.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
// These scripts write to (and may reset) the one shared database the live demo runs on.
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database (it may reset it and message real phones). Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

// SQL stand-ins for the section 6 verifiers, so decoys can be shown to trip none of them.
const FLAGS = `SELECT
  (SELECT count(*) FROM billing.charges c JOIN billing.subscriptions s ON s.id = c.subscription_id
     JOIN logistics.device_events e ON e.device_id = s.device_id AND e.type IN ('PICKED_UP','RECEIVED_AT_WAREHOUSE')
     WHERE c.merchant_id = $1 AND c.status NOT IN ('REVERSED', 'BLOCKED') AND to_date(c.period || '-01', 'YYYY-MM-DD') > e.at) charge_after_return,
  (SELECT count(*) FROM billing.charges c JOIN billing.subscriptions s ON s.id = c.subscription_id
     WHERE c.merchant_id = $1 AND c.status <> 'BLOCKED' AND NOT EXISTS (SELECT 1 FROM logistics.device_events e WHERE e.device_id = s.device_id AND e.type = 'DELIVERED')) charge_without_delivery,
  (SELECT count(*) FROM (SELECT 1 FROM billing.charges WHERE merchant_id = $1 AND status = 'BILLED' AND notice_sent_at IS NULL HAVING sum(amount) > 2000) x) silent_deduction,
  (SELECT count(*) FROM disputes.disputes d JOIN settlement.payments p ON p.id = d.payment_id WHERE d.merchant_id = $1 AND p.order_ref IS NULL AND d.merchant_contested) orphan_dispute,
  (SELECT count(*) FROM lending.loans l WHERE l.merchant_id = $1 AND l.status = 'ACTIVE' AND l.settlement_offer_amount IS NOT NULL
     AND (SELECT coalesce(sum(amount), 0) FROM lending.loan_payments WHERE loan_id = l.id AND kind = 'SETTLEMENT') >= l.settlement_offer_amount) zombie_loan,
  (SELECT count(*) FROM (SELECT source_ref FROM settlement.deductions WHERE merchant_id = $1 AND source_ref IS NOT NULL GROUP BY source_ref HAVING count(DISTINCT settlement_id) > 1) x) duplicate_deduction,
  (SELECT count(*) FROM settlement.deductions WHERE merchant_id = $1 AND type = 'FEE' AND source_ref IS NULL) deduction_without_source,
  (SELECT count(*) FROM logistics.device_events e JOIN logistics.devices d ON d.id = e.device_id WHERE d.merchant_id = $1 AND e.type = 'PICKUP_REQUESTED' AND e.at < now() - interval '14 days'
     AND NOT EXISTS (SELECT 1 FROM logistics.device_events x WHERE x.device_id = e.device_id AND x.type = 'PICKED_UP')) pickup_never_completed`;

async function main() {
  const { sql } = await import("../src/inject/lib");
  const { reset } = await import("../src/inject/reset");
  const { inject, DECOYS } = await import("../src/inject");
  const { drain } = await import("../src/inject/watch");
  const rows = (text: string, ...p: unknown[]) => sql().query(text, p) as Promise<any[]>;
  const row = async (text: string, ...p: unknown[]) => (await rows(text, ...p))[0];
  const one = async (text: string, ...p: unknown[]) => Number((await row(text, ...p)).n);
  const flags = async (mid: string) => Object.fromEntries(Object.entries(await row(FLAGS, mid)).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v));
  const sumDeducted = (refs: string[]) => one(`SELECT coalesce(sum(amount), 0) n FROM settlement.deductions WHERE source_ref = ANY($1::text[])`, refs);

  const r = await reset();
  console.log(`reset: truncate ${r.truncate_ms} ms, total ${r.ms} ms`);

  const plan: [string, string, { failed?: boolean }?][] = [
    ["rent_after_return", "demo"], ["ghost_device", "demo"], ["pickup_never_completed", "demo"], ["pending_payment", "demo"], ["device_offline", "demo"],
    ["silent_deduction", "random"], ["orphan_dispute", "random"], ["zombie_loan", "random"], ["duplicate_deduction", "random"],
    ["deduction_without_source", "random"], ["pending_payment", "random", { failed: true }], ["zombie_loan", "MID-0030"],
    ["velocity_burst", "demo"], ["qr_swapped", "random"],
    ["legit_late_fee", "random"], ["merchant_refund", "random"], ["slow_day", "random"],
  ];
  const done: { type: string; injection_id: string; merchant_id: string; params: any }[] = [];
  for (const [type, target, opts] of plan) {
    const t0 = Date.now();
    const x = await inject(type, target, { ...opts, decoy: type in DECOYS });
    done.push({ type, ...x, params: (await row(`SELECT params FROM hisaab.injections WHERE id = $1`, x.injection_id)).params });
    console.log(`  ${type.padEnd(24)} ${x.merchant_id}  ${x.summary}  (${Date.now() - t0} ms)`);
  }
  const by = (t: string, i = 0) => done.filter((d) => d.type === t)[i];

  // Demo amounts, recomputed from ledger rows.
  const ra = by("rent_after_return");
  assert.equal(ra.merchant_id, "MID-0001");
  const raDed = await rows(`SELECT settlement_id, type::text type, amount FROM settlement.deductions WHERE source_ref = ANY($1::text[])`, ra.params.charge_ids);
  assert.equal(raDed.reduce((a, d) => a + d.amount, 0), 594, "rent_after_return = 594");
  assert.equal(raDed.filter((d) => d.type === "LATE_FEE").reduce((a, d) => a + d.amount, 0), 54);
  const latestId = (await row(`SELECT id FROM settlement.settlements WHERE merchant_id = 'MID-0001' ORDER BY date DESC LIMIT 1`)).id;
  assert.ok(raDed.every((d) => d.settlement_id === latestId && (d.type === "RENT" || d.type === "LATE_FEE")), "all in the LATEST settlement");
  assert.equal((await row(`SELECT status::text s FROM billing.subscriptions WHERE id = $1`, ra.params.subscription_id)).s, "ACTIVE");
  assert.equal(await sumDeducted(by("ghost_device").params.charge_ids), 405);
  assert.equal(await one(`SELECT count(*) n FROM logistics.device_events WHERE device_id = $1 AND type = 'DELIVERED'`, by("ghost_device").params.device_id), 0);
  const sd = await row(`SELECT amount, status::text status, notice_sent_at FROM billing.charges WHERE id = $1`, by("silent_deduction").params.charge_id);
  // notice_sent_at isn't asserted: a dashboard heartbeat may already have let the engine warn (send_warning sets it).
  assert.deepEqual([sd.amount, sd.status], [2800, "BILLED"]);
  assert.equal(await sumDeducted([by("orphan_dispute").params.dispute_id]), 1850);
  assert.equal((await row(`SELECT order_ref FROM settlement.payments WHERE id = $1`, by("orphan_dispute").params.payment_id)).order_ref, null);
  const dup = await rows(`SELECT settlement_id, amount FROM settlement.deductions WHERE source_ref = $1`, by("duplicate_deduction").params.charge_id);
  assert.deepEqual([dup.length, new Set(dup.map((d) => d.settlement_id)).size, dup[1].amount], [2, 2, 135]);
  const dws = await row(`SELECT type::text type, amount, source_ref FROM settlement.deductions WHERE id = $1`, by("deduction_without_source").params.deduction_id);
  assert.deepEqual([dws.type, dws.amount, dws.source_ref], ["FEE", 299, null]);
  assert.equal(await sumDeducted(by("pickup_never_completed").params.charge_ids), 270);
  const status = async (i: number) => (await row(`SELECT status::text s FROM settlement.payments WHERE id = $1`, by("pending_payment", i).params.payment_id)).s;
  assert.deepEqual([await status(0), await status(1)], ["PENDING", "FAILED"]);
  const offMin = await one(`SELECT extract(epoch FROM (now() AT TIME ZONE 'UTC') - last_seen_at) / 60 n FROM logistics.devices WHERE id = $1`, by("device_offline").params.device_id);
  assert.ok(Math.abs(offMin - 180) < 3, `device_offline: last seen ${offMin} min ago`);
  const slow = await row(`SELECT extract(dow FROM date) dow, gross FROM settlement.settlements WHERE id = $1`, by("slow_day").params.settlement_id);
  assert.ok(Number(slow.dow) === 0 && slow.gross <= 0.3 * by("slow_day").params.avg, "slow_day: Sunday, >= 70% below avg");

  const vb = await row(`SELECT count(*)::int n, count(DISTINCT payer_vpa)::int vpas, sum(amount)::int total, count(order_ref)::int orders,
    extract(epoch FROM max(created_at) - min(created_at)) span FROM settlement.payments WHERE id = ANY($1::text[]) AND status = 'SUCCESS'`, by("velocity_burst").params.payment_ids);
  assert.deepEqual([vb.n, vb.vpas, vb.total, vb.orders], [8, 1, 23, 8], "velocity_burst: 8 payments, one VPA, ₹23");
  assert.ok(Number(vb.span) <= 120, "velocity_burst within 2 min");
  const qr = by("qr_swapped"), after = qr.params.removed_after;
  assert.equal(await one(`SELECT count(*) n FROM settlement.payments WHERE merchant_id = $1 AND created_at > $2`, qr.merchant_id, after), 0, "qr_swapped: target silent");
  assert.ok(await one(`SELECT count(*) n FROM settlement.payments WHERE merchant_id <> $1 AND status = 'SUCCESS' AND created_at > $2`, qr.merchant_id, after), "qr_swapped: market still live");
  assert.equal(await one(`SELECT count(*) n FROM hisaab.outbox_events WHERE row_id = $1 AND op = 'DELETE' AND merchant_id = $2`, `qr_swapped:${qr.injection_id}`, qr.merchant_id), 1, "qr_swapped outbox row");
  assert.ok(qr.params.removed > 0 && qr.params.slot_avg >= 6, "qr_swapped: busy target actually went quiet");

  // Verifier stand-ins: each anomaly trips its own check, decoys trip none.
  const expect: Record<string, string> = {
    rent_after_return: "charge_after_return", ghost_device: "charge_without_delivery", silent_deduction: "silent_deduction", orphan_dispute: "orphan_dispute",
    zombie_loan: "zombie_loan", duplicate_deduction: "duplicate_deduction", deduction_without_source: "deduction_without_source", pickup_never_completed: "pickup_never_completed",
  };
  for (const d of done) {
    const f = await flags(d.merchant_id);
    if (d.type in DECOYS) assert.deepEqual(f, {}, `decoy ${d.type} on ${d.merchant_id} trips ${JSON.stringify(f)}`);
    else if (expect[d.type]) assert.ok(f[expect[d.type]], `${d.type} on ${d.merchant_id} should trip ${expect[d.type]}`);
  }
  console.log("  MID-0001 flags:", await flags("MID-0001"));

  assert.equal(await one(`SELECT count(*) n FROM settlement.settlements WHERE net <> gross - deductions_total OR net < 0`), 0, "net = gross - deductions_total");
  assert.equal(await one(`SELECT count(*) n FROM settlement.settlements s WHERE deductions_total <> (SELECT coalesce(sum(amount), 0) FROM settlement.deductions WHERE settlement_id = s.id)`), 0, "deductions_total = sum");
  assert.equal(await one(`SELECT count(*) n FROM hisaab.injections`), plan.length);
  // Processed or not: a live dashboard heartbeat may drain them before we look.
  for (const d of done) assert.ok(await one(`SELECT count(*) n FROM hisaab.outbox_events WHERE merchant_id = $1`, d.merchant_id), `outbox rows for ${d.merchant_id}`);
  console.log("inject ok");

  await new Promise((r) => setTimeout(r, 1600)); // past the watcher's debounce
  const drainAt = new Date();
  const w = await drain();
  console.log(`watch: drained ${w!.drained} events in ${w!.ms} ms`);
  for (const d of done) {
    const m = w!.merchants.find((x) => x.merchant_id === d.merchant_id);
    console.log(`  ${(d.type in DECOYS ? "decoy " : "") + d.type}`.padEnd(32), d.merchant_id, m ? `case=${m.case_id ?? "-"} findings=${m.findings}` : "not drained");
  }
  // Executed actions write new ledger rows (and outbox events) after the drain; only older ones must be gone.
  assert.equal(await one(`SELECT count(*) n FROM hisaab.outbox_events WHERE processed_at IS NULL AND created_at < $1`, drainAt.toISOString()), 0, "drained everything");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
