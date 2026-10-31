import { db } from "@/lib/db";

// Which merchant the demo WhatsApp phone speaks as. Defaults to the seeded demo merchant.
export async function activeDemoMid() {
  const row = await db.demoSettings.findUnique({ where: { id: 1 } });
  return row?.active_demo_mid ?? "MID-0001";
}

export const setActiveDemoMid = (mid: string) =>
  db.demoSettings.upsert({ where: { id: 1 }, create: { id: 1, active_demo_mid: mid }, update: { active_demo_mid: mid } });
