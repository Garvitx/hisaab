// Truncate all 7 schemas and reseed. Shared by `pnpm demo:reset` and POST /api/inject { reset: true }.
import { main as seed } from "../../prisma/seed";

export async function reset() {
  const t0 = Date.now();
  const { db } = await import("@/lib/db");
  // Discovered, not listed, so tables added later are wiped too. WhatsApp history survives a reset:
  // the phones' real chat (and wa_inbox dedupe) must not vanish every time the demo restarts.
  const tables = (await db.$queryRawUnsafe(
    `SELECT format('%I.%I', table_schema, table_name) t FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema IN ('merchants','settlement','billing','logistics','disputes','lending','hisaab')
       AND format('%I.%I', table_schema, table_name) NOT IN ('hisaab.wa_inbox', 'hisaab.conversations', 'hisaab.messages')`,
  )) as { t: string }[];
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`);
  const truncate_ms = Date.now() - t0;
  await seed();
  return { truncate_ms, ms: Date.now() - t0 };
}
