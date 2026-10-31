import { connection } from "next/server";
import { db } from "@/lib/db";
import { caseRows } from "../../cases";

// The UI may read every silo directly (rule 2 binds agent code only).
// Two stages of five queries: one stage of ten tripped the Neon pool.
async function load(mid: string) {
  const w = { merchant_id: mid };
  const [merchant, settlements, payments, credits, subscriptions] = await Promise.all([
    db.merchant.findUnique({ where: { id: mid } }),
    db.settlement.findMany({ where: w, orderBy: { date: "desc" }, take: 21, include: { deductions: true } }),
    db.payment.findMany({ where: w, orderBy: { created_at: "desc" }, take: 25 }),
    db.credit.findMany({ where: w, orderBy: { created_at: "desc" } }),
    db.subscription.findMany({
      where: w,
      orderBy: { started_at: "asc" },
      include: { charges: { orderBy: { period: "desc" }, take: 12 } },
    }),
  ]);
  if (!merchant) return null;
  const [devices, disputes, loans, cases] = await Promise.all([
    db.device.findMany({
      where: w,
      include: { events: { orderBy: { at: "asc" } }, replacement_requests: { orderBy: { created_at: "desc" } } },
    }),
    db.dispute.findMany({ where: w }),
    db.loan.findMany({ where: w, include: { payments: { orderBy: { at: "desc" } } } }),
    caseRows(w, 50),
  ]);
  return { merchant, settlements, payments, credits, subscriptions, devices, disputes, loans, cases };
}
export type MerchantDetail = NonNullable<Awaited<ReturnType<typeof load>>>;

export async function GET(_req: Request, ctx: RouteContext<"/api/ui/merchants/[mid]">) {
  await connection();
  const data = await load((await ctx.params).mid);
  return data ? Response.json(data) : Response.json({ error: "not found" }, { status: 404 });
}
