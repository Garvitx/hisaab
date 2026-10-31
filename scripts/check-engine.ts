// Run: pnpm tsx scripts/check-engine.ts. Writes two anomalies into MID-0007, runs the engine end to end, cleans up.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
// These scripts write to (and may reset) the one shared database the live demo runs on.
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database (it may reset it and message real phones). Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

const MID = "MID-0007"; // no loans, no disputes, no EDC
const DAY = 86_400_000;

async function main() {
  // Dynamic imports: db.ts reads DATABASE_URL at load, which must happen after dotenv.
  const { db } = await import("../src/lib/db");
  const { reconcile } = await import("../src/engine/reconcile");
  const { verify } = await import("../src/engine/verifiers");
  const { detectMerchant } = await import("../src/engine/detect");
  const { proposeAction, undoAction, rejectAction } = await import("../src/engine/actions");
  const t0 = new Date();

  // 1. No false positives on untouched seed merchants (anything with outbox rows was touched by someone).
  const touched = new Set((await db.outboxEvent.findMany({ where: { merchant_id: { not: null } }, distinct: ["merchant_id"], select: { merchant_id: true } })).map((o) => o.merchant_id));
  const clean = (await db.merchant.findMany({ select: { id: true } })).map((m) => m.id).filter((id) => id !== MID && !touched.has(id));
  const fp: string[] = [];
  for (const id of clean) fp.push(...(await reconcile(id)).map((f) => `${id} ${f.check}`));
  assert.deepEqual(fp, [], "reconcile flagged a clean merchant");
  // The hunter-only checks too, over every ref they could be pointed at, on a loan merchant and a lost-dispute merchant.
  for (const id of ["MID-0003", "MID-0012", "MID-0001"].filter((id) => clean.includes(id))) {
    const deds = await db.deduction.findMany({ where: { merchant_id: id } });
    const devs = await db.device.findMany({ where: { merchant_id: id } });
    const probes = [
      ...[...new Set(deds.map((d) => d.source_ref).filter(Boolean))].map((s) => verify("duplicate_deduction", { source_ref: s }, { merchant_id: id })),
      ...deds.filter((d) => d.type === "FEE").map((d) => verify("deduction_without_source", { deduction_id: d.id }, { merchant_id: id })),
      ...devs.map((d) => verify("pickup_never_completed", { device_id: d.id }, { merchant_id: id })),
    ];
    const hits = (await Promise.all(probes)).filter((r) => r.ok);
    assert.equal(hits.length, 0, `hunter checks flagged clean ${id}: ${hits.map((h) => h.title)}`);
  }
  assert.ok(clean.length >= 5, `only ${clean.length} untouched merchants: run pnpm demo:reset`);
  console.log(`ok  no false positives on ${clean.length} untouched merchants`);

  // 2. Write a rent_after_return shape (returned ~4 months back + a ₹54 late fee after it) and a duplicate rent deduction.
  const sub = await db.subscription.findFirstOrThrow({ where: { merchant_id: MID }, include: { charges: { orderBy: { period: "asc" } } } });
  const latest = await db.settlement.findFirstOrThrow({ where: { merchant_id: MID }, orderBy: { date: "desc" } });
  const back = new Date(Date.UTC(2026, 5, 26));
  const ev = await db.deviceEvent.createManyAndReturn({ data: [
    { device_id: sub.device_id, type: "PICKED_UP", at: back, actor: "Delhivery" },
    { device_id: sub.device_id, type: "RECEIVED_AT_WAREHOUSE", at: new Date(+back + 3 * DAY), actor: "warehouse" },
  ] });
  const fee = await db.charge.create({ data: { subscription_id: sub.id, merchant_id: MID, period: "2026-10", kind: "LATE_FEE", amount: 54, status: "DEDUCTED", deducted_in_settlement_id: latest.id } });
  const sep = sub.charges.find((c) => c.period === "2026-09")!;
  const dup = await db.deduction.create({ data: { settlement_id: latest.id, merchant_id: MID, type: "RENT", amount: 135, source_ref: sep.id } });
  const feeDed = await db.deduction.create({ data: { settlement_id: latest.id, merchant_id: MID, type: "LATE_FEE", amount: 54, source_ref: fee.id } });
  // Keep the live watcher (if a dashboard is open) from racing this script on the same merchant.
  await db.outboxEvent.updateMany({ where: { merchant_id: MID, processed_at: null }, data: { processed_at: new Date() } });

  try {
    const found = await reconcile(MID);
    assert.deepEqual(found.map((f) => [f.check, f.amount]), [["charge_after_return", 594]], "reconcile: only the rule check, ₹594");
    const v = await verify("duplicate_deduction", { source_ref: sep.id }, { merchant_id: MID });
    assert.equal(v.ok, true); assert.equal(v.amount, 135);
    assert.equal((await verify("duplicate_deduction", { source_ref: sep.id }, { merchant_id: "MID-0002" })).ok, false, "refs from another merchant are rejected");
    console.log("ok  reconcile ₹594 charge_after_return, verify ₹135 duplicate_deduction");

    // 3. Full detect with a fake hunter: one real hypothesis, one hallucinated.
    const hunt = async () => [
      { title: "Sep rent taken twice", check: "duplicate_deduction", refs: { deduction_id: dup.id }, why: "same source_ref twice" },
      { title: "Made up", check: "duplicate_deduction", refs: { source_ref: "nope" }, why: "llm guess" },
    ];
    const r = await detectMerchant(MID, { firstEventAt: new Date(Date.now() - 1200), events: [], hunt });
    assert.ok(r.case_id); assert.equal(r.findings, 3);
    const c = await db.case.findUniqueOrThrow({ where: { id: r.case_id }, include: { findings: true, actions: true } });
    assert.ok(c.detect_ms! >= 1200);
    const hunter = c.findings.filter((f) => f.origin === "HUNTER");
    assert.deepEqual(hunter.map((f) => [f.verified, f.amount]).sort(), [[false, 0], [true, 135]]);
    const byType = Object.fromEntries(c.actions.map((a) => [a.type, a]));
    assert.deepEqual(c.actions.map((a) => `${a.type}:${a.tier}:${a.status}`).sort(), ["close_subscription:AUTO:EXECUTED", "reverse_charge:AUTO:EXECUTED", "reverse_deduction:AUTO:EXECUTED"]);
    assert.equal(c.status, "RESOLVED");
    const credits = await db.credit.findMany({ where: { action_id: { in: c.actions.map((a) => a.id) } } });
    assert.deepEqual(credits.map((x) => x.amount).sort((a, b) => a - b), [135, 594]);
    assert.equal(await db.charge.count({ where: { subscription_id: sub.id, status: "REVERSED" } }), 5);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status, "CLOSED");
    assert.ok(await db.traceEvent.count({ where: { case_id: c.id, kind: "POLICY" } }) >= 3);
    console.log(`ok  detect opened case in ${c.detect_ms} ms: AUTO ₹594 + ₹135 credited, subscription closed, unverified hypothesis kept`);

    // Re-running must not reopen anything.
    assert.equal((await detectMerchant(MID, { firstEventAt: new Date(), events: [], hunt })).case_id, null, "dedupe");

    await undoAction(byType.reverse_charge.id, { decided_by: "check", via: "DASHBOARD" });
    await undoAction(byType.close_subscription.id, { decided_by: "check", via: "DASHBOARD" });
    assert.equal(await db.credit.count({ where: { action_id: byType.reverse_charge.id } }), 0);
    assert.equal(await db.charge.count({ where: { subscription_id: sub.id, status: "REVERSED" } }), 0);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status, "ACTIVE");
    assert.equal((await db.action.findUniqueOrThrow({ where: { id: byType.reverse_charge.id } })).status, "UNDONE");
    assert.equal((await reconcile(MID))[0]?.amount, 594, "undo restored the ledger");
    console.log("ok  undo reverted charges, credit and subscription");

    // 4. The dial is live.
    const before = await db.policy.findUniqueOrThrow({ where: { id: 1 } });
    await db.policy.update({ where: { id: 1 }, data: { auto_limit: 100 } });
    try {
      const dupFinding = hunter.find((f) => f.verified)!;
      const a = await proposeAction({ case_id: c.id, finding_id: dupFinding.id, type: "reverse_deduction" });
      assert.equal(a.tier, "APPROVAL"); assert.equal(a.status, "PENDING"); assert.equal(a.amount, 135);
      assert.equal((await db.case.findUniqueOrThrow({ where: { id: c.id } })).status, "AWAITING_APPROVAL");
      assert.equal(await db.credit.count({ where: { action_id: a.id } }), 0, "nothing moves before approval");
      await rejectAction(a.id, { decided_by: "check", via: "DASHBOARD" });
      assert.equal((await db.case.findUniqueOrThrow({ where: { id: c.id } })).status, "RESOLVED");
      console.log("ok  auto_limit 100 -> APPROVAL, reject resolves the case");
    } finally {
      await db.policy.update({ where: { id: 1 }, data: { auto_limit: before.auto_limit } });
    }
  } finally {
    // 5. Clean up: undo whatever is still executed, then delete what this script wrote.
    const { runInverse } = await import("../src/engine/executors");
    const cases = await db.case.findMany({ where: { merchant_id: MID, opened_at: { gte: t0 } }, include: { actions: true } });
    for (const a of cases.flatMap((x) => x.actions)) {
      if ((a.status === "EXECUTED" || a.status === "APPROVED") && Array.isArray(a.inverse)) await runInverse(a.inverse as never);
      await db.credit.deleteMany({ where: { action_id: a.id } });
    }
    await db.case.deleteMany({ where: { id: { in: cases.map((x) => x.id) } } });
    await db.deduction.deleteMany({ where: { id: { in: [dup.id, feeDed.id] } } });
    await db.charge.deleteMany({ where: { id: fee.id } });
    await db.deviceEvent.deleteMany({ where: { id: { in: ev.map((e) => e.id) } } });
    await db.outboxEvent.deleteMany({ where: { merchant_id: MID, created_at: { gte: t0 } } });
    assert.equal((await reconcile(MID)).length, 0, "cleanup left MID-0007 clean");
    console.log("ok  cleaned up");
  }
}

main().then(() => process.exit(0), (e) => { console.error(e?.error ?? e); process.exit(1); });
