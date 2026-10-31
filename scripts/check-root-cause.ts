// Run: ALLOW_LIVE_CHECKS=1 tsx scripts/check-root-cause.ts
// End to end on non-demo, unclaimed shops: warehouse_bug x5 at NOIDA-2 -> each fixed -> one root cause
// with a disabled guard -> enable it -> x1 at NOIDA-2 is BLOCKED (nothing deducted) -> x1 at GGN-1 is not.
// Deletes every row it made at the end (ledger rows, cases, root causes, guards), even on failure.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database. Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sql } = await import("../src/inject/lib");
  const { inject } = await import("../src/inject");
  const { drain } = await import("../src/inject/watch");
  const { scheduleRootCauses, groupFindings } = await import("../src/agent/root-cause");
  const { reconcile } = await import("../src/engine/reconcile");
  const { POST: enableGuard } = await import("../src/app/api/root-causes/[id]/guard/route");
  const t0 = new Date();
  const injected: { id: string; merchant_id: string; params: any }[] = [];
  const ruleIds = new Set<string>();

  assert.equal(await db.guardRule.count({ where: { enabled: true } }), 0, "another guard is already enabled; it would skew this check");

  const run = async (count: number, location: string) => {
    const r = await inject("warehouse_bug", "random", { count, location }) as unknown as { results: { injection_id: string; merchant_id: string; summary: string }[] };
    for (const x of r.results) {
      const inj = await db.injection.findUniqueOrThrow({ where: { id: x.injection_id } });
      injected.push({ id: inj.id, merchant_id: x.merchant_id, params: inj.params });
      console.log(`  ${x.merchant_id}: ${x.summary}`);
    }
    return r.results.map((x) => x.merchant_id);
  };
  // Another watcher (a dashboard, prod) may drain these events first; either way a case must appear.
  const casesFor = async (mids: string[], want: boolean) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await drain();
      const n = new Set((await db.case.findMany({ where: { merchant_id: { in: mids }, opened_at: { gte: t0 } }, select: { merchant_id: true } })).map((c) => c.merchant_id)).size;
      if (want ? n === mids.length : i >= 4) return n;
    }
    throw new Error(`timed out waiting for cases on ${mids.join(", ")}`);
  };
  const sumCharges = (ids: string[]) => db.charge.aggregate({ where: { id: { in: ids } }, _sum: { amount: true } }).then((x) => x._sum.amount ?? 0);
  const settlementConsistent = async (id: string) => {
    const s = await db.settlement.findUniqueOrThrow({ where: { id }, include: { deductions: true } });
    assert.equal(s.deductions.reduce((a, d) => a + d.amount, 0), s.deductions_total, `settlement ${id} deductions_total`);
    assert.equal(s.gross - s.deductions_total, s.net, `settlement ${id} net`);
  };

  try {
    console.log("1. warehouse_bug x5 at NOIDA-2");
    const five = await run(5, "NOIDA-2");
    for (const x of injected) await settlementConsistent(x.params.settlement_id);
    assert.equal(await casesFor(five, true), 5);
    for (const x of injected) {
      const charges = await db.charge.findMany({ where: { id: { in: x.params.charge_ids } } });
      assert.ok(charges.every((c) => c.status === "REVERSED"), `${x.merchant_id}: every wrong charge reversed`);
    }
    console.log("   all 5 detected and reversed individually");

    await scheduleRootCauses(0);
    const rc = await db.rootCause.findFirst({ where: { check: "charge_after_return", signature: { path: ["location"], equals: "NOIDA-2" } }, include: { guards: true } });
    assert.ok(rc, "root cause for NOIDA-2");
    const group = (await groupFindings()).find((g) => g.attr === "location" && g.value === "NOIDA-2")!;
    const affected = rc.affected_merchants as string[];
    for (const mid of five) assert.ok(affected.includes(mid), `${mid} in root cause`);
    assert.equal(affected.length, new Set(group.rows.map((r) => r.merchant_id)).size, "merchant count");
    assert.equal(rc.total_amount, group.rows.reduce((a, r) => a + r.amount, 0), "total = sum of findings");
    const mine = await sumCharges(injected.flatMap((x) => x.params.charge_ids));
    assert.ok(rc.total_amount >= mine, "total covers the 5 injected shops");
    assert.ok(rc.summary && rc.ticket_md?.includes("| Merchant |"), "narrative + engine evidence table");
    assert.equal(rc.guards.length, 1);
    const guard = rc.guards[0];
    ruleIds.add(guard.id);
    assert.equal(guard.enabled, false, "proposed guard starts disabled");
    assert.equal(guard.template, "pause_rent_after_warehouse_receipt");
    assert.deepEqual(guard.params, { location: "NOIDA-2" });
    console.log(`   root cause: ${affected.length} merchants, Rs ${rc.total_amount}, guard ${guard.template} (disabled)`);

    const res = await enableGuard(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: rc.id }) } as never);
    assert.equal(res.status, 200);
    assert.equal((await db.rootCause.findUniqueOrThrow({ where: { id: rc.id } })).status, "GUARDED");

    console.log("2. guard on, warehouse_bug x1 at NOIDA-2");
    const [blockedMid] = await run(1, "NOIDA-2");
    const b = injected.at(-1)!;
    const bc = await db.charge.findMany({ where: { id: { in: b.params.charge_ids } } });
    assert.ok(bc.length && bc.every((c) => c.status === "BLOCKED" && !c.deducted_in_settlement_id), "every charge BLOCKED");
    assert.equal(await db.deduction.count({ where: { source_ref: { in: b.params.charge_ids } } }), 0, "nothing deducted");
    await settlementConsistent(b.params.settlement_id);
    const g = await db.guardRule.findUniqueOrThrow({ where: { id: guard.id } });
    assert.equal(g.blocked_count, bc.length, "blocked_count counts each blocked charge");
    assert.equal(await db.guardEvent.count({ where: { guard_rule_id: guard.id, merchant_id: blockedMid } }), bc.length);
    assert.equal(await casesFor([blockedMid], false), 0, "a blocked charge is not owed, so no case");
    // Rules only, run here, so a failed background detection cannot make the line above pass vacuously.
    assert.equal((await reconcile(blockedMid)).filter((c) => c.check === "charge_after_return").length, 0, "rules see nothing owed");
    console.log(`   ${bc.length} charges blocked, blocked_count ${g.blocked_count}, no case`);

    console.log("3. guard on, warehouse_bug x1 at GGN-1");
    const [ggn] = await run(1, "GGN-1");
    const gc = await db.charge.findMany({ where: { id: { in: injected.at(-1)!.params.charge_ids } } });
    assert.ok(gc.every((c) => c.status !== "BLOCKED"), "GGN-1 not blocked");
    assert.equal(await casesFor([ggn], true), 1);
    console.log("   GGN-1 deducted and detected as usual");
    console.log("ok");
  } finally {
    await cleanup();
  }

  async function cleanup() {
    await scheduleRootCauses(0); // let a pass a drain kicked off finish, so its rows are cleaned up too
    const mids = [...new Set(injected.map((x) => x.merchant_id))];
    const rcs = (await db.rootCause.findMany({ where: { created_at: { gte: t0 } }, select: { id: true } })).map((r) => r.id);
    for (const r of await db.guardRule.findMany({ where: { OR: [{ root_cause_id: { in: rcs } }, { created_at: { gte: t0 } }] }, select: { id: true } })) ruleIds.add(r.id);
    const cases = (await db.case.findMany({ where: { merchant_id: { in: mids }, opened_at: { gte: t0 } }, select: { id: true } })).map((c) => c.id);
    const actions = (await db.action.findMany({ where: { case_id: { in: cases } }, select: { id: true } })).map((a) => a.id);
    const s = sql();
    const q: Parameters<typeof s.transaction>[0] & unknown[] = [];
    for (const x of injected) {
      const p = x.params;
      // Undo the settlement totals before the deductions go.
      q.push(s.query(`UPDATE settlement.settlements st SET deductions_total = st.deductions_total - d.n, net = st.net + d.n
        FROM (SELECT settlement_id, sum(amount)::int n FROM settlement.deductions WHERE source_ref = ANY($1::text[]) GROUP BY 1) d WHERE st.id = d.settlement_id`, [p.charge_ids]));
      q.push(s.query(`DELETE FROM settlement.deductions WHERE source_ref = ANY($1::text[])`, [p.charge_ids]));
      q.push(s.query(`DELETE FROM billing.subscriptions WHERE id = $1`, [p.subscription_id]));
      q.push(s.query(`DELETE FROM logistics.devices WHERE id = $1`, [p.device_id]));
    }
    q.push(s.query(`DELETE FROM settlement.credits WHERE action_id = ANY($1::text[])`, [actions]));
    q.push(s.query(`DELETE FROM hisaab.injections WHERE id = ANY($1::text[])`, [injected.map((x) => x.id)]));
    q.push(s.query(`DELETE FROM hisaab.cases WHERE id = ANY($1::text[])`, [cases]));
    q.push(s.query(`DELETE FROM hisaab.guard_rules WHERE id = ANY($1::text[])`, [[...ruleIds]]));
    q.push(s.query(`DELETE FROM hisaab.root_causes WHERE id = ANY($1::text[])`, [rcs]));
    // The settlement updates above fire the outbox trigger; nothing to detect in a cleanup.
    q.push(s.query(`UPDATE hisaab.outbox_events SET processed_at = now() WHERE processed_at IS NULL AND created_at = now()`));
    await s.transaction(q);
    console.log(`cleanup: ${mids.length} merchants, ${cases.length} cases, ${rcs.length} root causes, ${ruleIds.size} guards removed`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
