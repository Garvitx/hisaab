import { connection } from "next/server";
import { db } from "@/lib/db";

async function load() {
  const [actions, merchants] = await Promise.all([
    db.action.findMany({
      orderBy: { created_at: "desc" },
      take: 300,
      include: {
        case: { select: { merchant_id: true, summary: true } },
        finding: { select: { title: true, origin: true, check: true } },
      },
    }),
    db.merchant.findMany({ select: { id: true, business_name: true } }),
  ]);
  const name = new Map(merchants.map((m) => [m.id, m.business_name]));
  return actions.map(({ inverse: _inverse, ...a }) => ({ ...a, business_name: name.get(a.case.merchant_id) ?? a.case.merchant_id }));
}
export type AuditRow = Awaited<ReturnType<typeof load>>[number];

export async function GET() {
  await connection();
  return Response.json(await load());
}
