import { connection } from "next/server";
import { db } from "@/lib/db";
import { day, inr, month } from "@/components/format";

// "Mera Hisaab": what the merchant sees. Every deduction gets a plain Hinglish line.
// One stage of parallel reads: every round trip to Neon costs about half a second.
async function load(mid: string) {
  const w = { merchant_id: mid };
  const [merchant, settlements, credits, charges, disputes, loans, undone, messages, payments, devices] = await Promise.all([
    db.merchant.findUnique({
      where: { id: mid },
      select: { id: true, business_name: true, owner_name: true, city: true, language: true },
    }),
    db.settlement.findMany({ where: w, orderBy: { date: "desc" }, take: 10, include: { deductions: true } }),
    db.credit.findMany({ where: w, orderBy: { created_at: "desc" }, take: 20 }),
    db.charge.findMany({ where: w, orderBy: { period: "asc" } }),
    db.dispute.findMany({ where: w }),
    db.loan.findMany({ where: { ...w, status: "ACTIVE" } }),
    db.action.findMany({ where: { status: "UNDONE", case: w }, select: { id: true } }),
    db.message.findMany({
      where: { conversation: w, audience: "MERCHANT" },
      orderBy: { created_at: "desc" },
      take: 60,
      select: { id: true, direction: true, type: true, text: true, transcript: true, media_url: true, created_at: true },
    }),
    db.payment.findMany({
      where: w,
      orderBy: { created_at: "desc" },
      take: 15,
      select: { id: true, amount: true, payer_name: true, payer_vpa: true, status: true, created_at: true },
    }),
    db.device.findMany({ where: w, orderBy: { model: "desc" }, select: { id: true, model: true, last_seen_at: true } }),
  ]);
  if (!merchant) return null;
  const billed = charges.filter((c) => c.status === "BILLED");
  const charge = new Map(charges.map((c) => [c.id, c]));
  const dispute = new Map(disputes.map((d) => [d.id, d]));

  const explain = (d: { type: string; source_ref: string | null }) => {
    const c = d.source_ref ? charge.get(d.source_ref) : undefined;
    switch (d.type) {
      case "RENT":
        return c ? `Soundbox ka kiraya, ${month(c.period)}` : "Soundbox ka mahine ka kiraya";
      case "LATE_FEE":
        return c ? `Kiraya der se bharne ki late fee, ${month(c.period)}` : "Kiraya der se bharne ki late fee";
      case "DISPUTE": {
        const x = d.source_ref ? dispute.get(d.source_ref) : undefined;
        return x ? `Customer ne payment par shikayat ki (${x.reason}), isliye paisa roka gaya` : "Customer ki shikayat (dispute) par paisa roka gaya";
      }
      case "LOAN_EMI":
        return "Paytm loan ki kisht (EMI)";
      default:
        return "Paytm service fee";
    }
  };

  const isUndone = new Set(undone.map((a) => a.id));

  const warnings = [
    ...(billed.length
      ? [
          {
            id: "billed",
            text: `Agle settlement se ${inr(billed.reduce((a, c) => a + c.amount, 0))} katne wala hai: ${billed
              .map((c) => `${c.kind === "RENT" ? "kiraya" : "late fee"} ${month(c.period)}`)
              .join(", ")}`,
          },
        ]
      : []),
    ...disputes
      .filter((d) => d.status === "OPEN" || d.status === "DEDUCTED")
      .map((d) => ({
        id: d.id,
        text: `Ek customer ki shikayat khuli hai (${d.reason})${d.response_due_at ? `, jawab ${day(d.response_due_at)} tak dena hai` : ""}`,
      })),
    ...loans.map((l) => ({ id: l.id, text: `Loan ki EMI har settlement se katti hai. Baaki: ${inr(l.outstanding)}` })),
  ];

  return {
    merchant,
    settlements: settlements.map((s) => ({
      id: s.id,
      date: s.date,
      gross: s.gross,
      deductions_total: s.deductions_total,
      net: s.net,
      deductions: s.deductions.map((d) => ({ id: d.id, type: d.type, amount: d.amount, text: explain(d) })),
    })),
    credits: credits.map((c) => ({ ...c, undone: !!c.action_id && isUndone.has(c.action_id) })),
    warnings,
    devices,
    messages: messages.reverse(),
    payments: payments.map(({ payer_name, payer_vpa, ...p }) => ({ ...p, payer: payer_name || payer_vpa })),
  };
}
export type MeraHisaab = NonNullable<Awaited<ReturnType<typeof load>>>;

export async function GET(_req: Request, ctx: RouteContext<"/api/ui/m/[mid]">) {
  await connection();
  const data = await load((await ctx.params).mid);
  return data ? Response.json(data) : Response.json({ error: "not found" }, { status: 404 });
}
