import { connection } from "next/server";
import { db } from "@/lib/db";
import { caseCost } from "@/lib/cost";

async function load(id: string) {
  const c = await db.case.findUnique({
    where: { id },
    include: {
      findings: true,
      actions: { orderBy: { created_at: "asc" } },
      trace_events: { orderBy: [{ seq: "asc" }, { created_at: "asc" }] },
    },
  });
  if (!c) return null;
  const [merchant, cost] = await Promise.all([db.merchant.findUnique({ where: { id: c.merchant_id } }), caseCost(id)]);
  return { ...c, merchant, cost };
}
export type CaseDetail = NonNullable<Awaited<ReturnType<typeof load>>>;

export async function GET(_req: Request, ctx: RouteContext<"/api/ui/cases/[id]">) {
  await connection();
  const data = await load((await ctx.params).id);
  return data ? Response.json(data) : Response.json({ error: "not found" }, { status: 404 });
}
