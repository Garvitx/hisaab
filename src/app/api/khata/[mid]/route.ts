import { connection } from "next/server";
import { db } from "@/lib/db";
import { drafts, label, pendingForMe } from "@/khata/entries";
import { khataPeriod, udhaarBalances } from "@/khata/balances";
import { reminderLink } from "@/khata/settle";

// The khata for the tap page and /m/[mid]: today's money by source, open drafts, udhaar per
// counterparty, and other shops' requests waiting for this merchant's Haan / Nahi.
async function load(mid: string) {
  const [merchant, today, open, balances, asks] = await Promise.all([
    db.merchant.findUnique({ where: { id: mid }, select: { id: true, business_name: true } }),
    khataPeriod(mid),
    drafts(mid),
    udhaarBalances(mid),
    pendingForMe(mid),
  ]);
  if (!merchant) return null;
  const { entries: _e, ...totals } = today;
  return {
    merchant,
    today: totals,
    drafts: open,
    // A shop I owe gets a "Pay" link straight to their udhaar (same link their reminder carries).
    balances: balances.map(({ pay_entry, ...b }) => ({ ...b, pay_link: pay_entry && process.env.QR_SECRET ? reminderLink(pay_entry.mid, pay_entry.id) : null })),
    requests: asks.map((e) => ({ id: e.id, from: e.counterparty_name, from_mid: e.counterparty_mid, amount: e.amount, kind: e.kind, label: label(e) })),
  };
}
export type KhataView = NonNullable<Awaited<ReturnType<typeof load>>>;

export async function GET(_req: Request, ctx: RouteContext<"/api/khata/[mid]">) {
  await connection();
  const data = await load((await ctx.params).mid);
  return data ? Response.json(data) : Response.json({ error: "not found" }, { status: 404 });
}
