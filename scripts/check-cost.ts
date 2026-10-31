// Run: ALLOW_LIVE_CHECKS=1 pnpm tsx scripts/check-cost.ts
// (Pricing math is offline in src/config/pricing.check.ts.) One real rent_after_return on an unclaimed non-demo merchant: the real
// hunter and notifier run (a few rupees of tokens), and the case must carry their cost and its resolution time.
// The case is left in place (it is a normal fixed anomaly, like one from the inject panel) so its page can be shown.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database and calls Anthropic. Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { inject } = await import("../src/inject");
  const { detectMerchant } = await import("../src/engine/detect");
  const { hunt } = await import("../src/agent/hunter");
  const { notifyCase } = await import("../src/agent/outreach");
  const { activeDemoMid } = await import("../src/lib/demo");

  // Never MID-0001, the switcher's merchant or a claimed shop; prefer one nobody injected yet.
  const [claimed, used, active] = await Promise.all([
    db.phoneBinding.findMany({ select: { merchant_id: true } }),
    db.injection.findMany({ select: { merchant_id: true }, distinct: ["merchant_id"] }),
    activeDemoMid(),
  ]);
  const no = new Set([...claimed.map((b) => b.merchant_id), active, "MID-0001"]);
  const pool = (await db.merchant.findMany({ where: { is_demo: false }, select: { id: true } })).map((m) => m.id).filter((id) => !no.has(id));
  const fresh = pool.filter((id) => !used.some((u) => u.merchant_id === id));
  const mid = (fresh.length ? fresh : pool)[0];
  assert.ok(mid, "no safe merchant to test on");

  const firstEventAt = new Date();
  const x = await inject("rent_after_return", mid);
  // Claim this merchant's outbox rows right away (the live watcher waits 1.5 s), so the detection
  // below runs on this branch's code instead of a deployed heartbeat's.
  const evs = await db.$queryRaw<{ schema: string; table: string; row_id: string; op: string }[]>`
    UPDATE hisaab.outbox_events SET processed_at = now() WHERE merchant_id = ${mid} AND processed_at IS NULL
    RETURNING "schema", "table", row_id, op`;
  console.log(`injected ${x.summary} on ${mid}, claimed ${evs.length} events`);

  const r = await detectMerchant(mid, { firstEventAt, events: evs, hunt });
  assert.ok(r.case_id, "rent_after_return opened a case");
  await notifyCase(r.case_id!);

  const cs = await db.case.findUniqueOrThrow({ where: { id: r.case_id! } });
  const calls = await db.llmCall.findMany({ where: { case_id: cs.id } });
  const speech = await db.speechCall.findMany({ where: { case_id: cs.id } });
  const roles = new Set(calls.map((k) => k.role));
  console.log(`case ${cs.id} ${cs.status} resolution_ms=${cs.resolution_ms} ai_cost_inr=${cs.ai_cost_inr}`);
  for (const k of calls) console.log(`  ${k.role.padEnd(9)} ${k.model.padEnd(20)} in=${k.input_tokens} out=${k.output_tokens} cr=${k.cache_read_tokens} cw=${k.cache_write_tokens} ${k.ms} ms ₹${k.cost_inr.toFixed(4)}`);

  assert.equal(cs.status, "RESOLVED", "₹594 is under the auto limit");
  assert.ok(cs.resolution_ms != null && cs.resolution_ms > 0 && cs.resolution_ms === cs.resolved_at!.getTime() - cs.opened_at.getTime(), "resolution_ms = resolved_at - opened_at");
  assert.ok(roles.has("HUNTER"), "hunter call attached to the case");
  assert.ok(roles.has("NOTIFIER"), "notifier call carries the case_id");
  assert.ok(calls.every((k) => k.input_tokens > 0 && k.output_tokens > 0 && k.cost_inr > 0), "every call has tokens and a cost");
  const sum = [...calls, ...speech].reduce((a, k) => a + k.cost_inr, 0);
  assert.ok(cs.ai_cost_inr! > 0 && Math.abs(cs.ai_cost_inr! - sum) < 1e-9, `ai_cost_inr ${cs.ai_cost_inr} = sum ${sum}`);
  console.log(`cost ok: /ops/cases/${cs.id}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
