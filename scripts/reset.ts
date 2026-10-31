// Run: pnpm demo:reset. Wipes all 7 schemas and reseeds, in one process.
import { main as seed } from "../prisma/seed";

async function main() {
  const t0 = Date.now();
  const { db } = await import("../src/lib/db");
  // Discovered, not listed, so tables added later are wiped too.
  const tables = (await db.$queryRawUnsafe(
    `SELECT format('%I.%I', table_schema, table_name) t FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema IN ('merchants','settlement','billing','logistics','disputes','lending','hisaab')`,
  )) as { t: string }[];
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`truncated ${tables.length} tables in ${Date.now() - t0} ms`);
  await seed();
  console.log(`reset ok in ${Date.now() - t0} ms`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
