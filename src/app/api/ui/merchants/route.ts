import { connection } from "next/server";
import { db } from "@/lib/db";

async function load() {
  const [merchants, cases, credits] = await Promise.all([
    db.merchant.findMany({ orderBy: { id: "asc" } }),
    db.case.findMany({ select: { merchant_id: true, status: true, opened_at: true } }),
    db.credit.groupBy({ by: ["merchant_id"], _sum: { amount: true } }),
  ]);
  const credited = new Map(credits.map((c) => [c.merchant_id, c._sum.amount ?? 0]));
  return merchants.map((m) => {
    const mine = cases.filter((c) => c.merchant_id === m.id);
    const open = mine.filter((c) => c.status !== "RESOLVED").length;
    return {
      id: m.id,
      business_name: m.business_name,
      owner_name: m.owner_name,
      city: m.city,
      segment: m.segment,
      language: m.language,
      is_demo: m.is_demo,
      health: (open ? "issue" : mine.length ? "fixed" : "clean") as "issue" | "fixed" | "clean",
      cases: mine.length,
      open,
      credited: credited.get(m.id) ?? 0,
      last_case_at: mine.reduce<Date | null>((a, c) => (!a || c.opened_at > a ? c.opened_at : a), null),
    };
  });
}
export type MerchantRow = Awaited<ReturnType<typeof load>>[number];

export async function GET() {
  await connection();
  return Response.json(await load());
}
