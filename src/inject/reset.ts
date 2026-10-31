// Truncate all 7 schemas and reseed. Shared by `pnpm demo:reset` and POST /api/inject { reset: true }.
import { main as seed } from "../../prisma/seed";

export async function reset() {
  const t0 = Date.now();
  const { db } = await import("@/lib/db");
  // Back to step 1: every table, discovered rather than listed so new ones are wiped too. That
  // includes the chat mirror and each chat's language choice (the next message asks again) and
  // the merchant switcher. Old WhatsApp messages stay on the phones; only our copy goes.
  // Judges' claimed numbers survive (the user's choice): remove them on /claim instead.
  const tables = (await db.$queryRawUnsafe(
    `SELECT format('%I.%I', table_schema, table_name) t FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema IN ('merchants','settlement','billing','logistics','disputes','lending','hisaab','khata')
       AND format('%I.%I', table_schema, table_name) <> 'hisaab.phone_bindings'`,
  )) as { t: string }[];
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`);
  const truncate_ms = Date.now() - t0;
  await seed();
  return { truncate_ms, ms: Date.now() - t0 };
}
