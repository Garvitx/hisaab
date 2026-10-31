// One-off: give existing DISPATCHED/DELIVERED device_events a warehouse location (the merchant's city hub, the
// same map prisma/seed.ts uses). Only fills NULLs, so re-running is a no-op. Dry run unless --apply.
// Skips the demo merchant, claimed shops and the shop the demo phone is acting as: those are never
// written by scripts. Run: tsx scripts/backfill-device-locations.ts [--apply]
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { sql } = await import("../src/inject/lib");
  const { WAREHOUSE } = await import("../prisma/seed");
  const s = sql();
  const [{ mid: acting }] = (await s.query(`SELECT coalesce((SELECT active_demo_mid FROM hisaab.demo_settings WHERE id = 1), 'MID-0001') mid`)) as { mid: string }[];
  const city = `CASE m.city ${Object.entries(WAREHOUSE).map(([c, w]) => `WHEN '${c}' THEN '${w}'`).join(" ")} END`;
  const from = `FROM logistics.devices d JOIN merchants.merchants m ON m.id = d.merchant_id
    WHERE e.device_id = d.id AND e.location IS NULL AND e.type IN ('DISPATCHED', 'DELIVERED') AND NOT m.is_demo AND m.id <> $1
      AND NOT EXISTS (SELECT 1 FROM hisaab.phone_bindings b WHERE b.merchant_id = m.id) AND (${city}) IS NOT NULL`;
  if (!process.argv.includes("--apply")) {
    const [{ n }] = (await s.query(`SELECT count(*)::int n FROM logistics.device_events e, ${from.replace(/^FROM /, "")}`, [acting])) as { n: number }[];
    return console.log(`${n} events would get a location (excluding ${acting}). Re-run with --apply.`);
  }
  // The outbox trigger fires per updated row; marking those rows processed in the same transaction keeps
  // the watcher from sending every merchant through detection (and the hunter) for a metadata fill.
  // now() is the transaction's start time, so created_at = now() picks exactly this transaction's rows.
  const [upd] = (await s.transaction([
    s.query(`UPDATE logistics.device_events e SET location = ${city} ${from} RETURNING e.id`, [acting]),
    s.query(`UPDATE hisaab.outbox_events SET processed_at = now()
      WHERE processed_at IS NULL AND "schema" = 'logistics' AND "table" = 'device_events' AND op = 'UPDATE' AND created_at = now()`),
  ])) as unknown[][];
  console.log(`filled location on ${upd.length} events (skipped ${acting}, demo and claimed shops)`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
