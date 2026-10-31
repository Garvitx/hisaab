// Udhaar that settles through Paytm: a reminder carries /pay/<creditor>?s=<qr sig>&u=<entry>, and a
// payment on that link pays the counterparty's open udhaar (oldest first) in the same transaction.
import { db } from "@/lib/db";
import type { KhataEntry, Prisma } from "@/generated/prisma/client";
import { qrSig } from "@/lib/qr-sig";
import { phonesFor } from "@/lib/claims";
import { activeDemoMid } from "@/lib/demo";
import { sendTemplate, sendText } from "@/channels/whatsapp";
import { trace } from "@/agent/trace";
import { udhaarBalances } from "./balances";
import { rs } from "./entries";

export class KhataPayError extends Error {}

const open = (e: Pick<KhataEntry, "amount" | "settled_amount">) => e.amount - e.settled_amount;
const sameParty = (e: KhataEntry) =>
  e.counterparty_mid ? { counterparty_mid: e.counterparty_mid } : { counterparty_mid: null, counterparty_name: { equals: e.counterparty_name ?? "", mode: "insensitive" as const } };

// The creditor's open UDHAAR_GIVEN entries for the same counterparty as entry u, oldest first.
async function openFor(tx: Prisma.TransactionClient | typeof db, mid: string, u: string) {
  const e = await tx.khataEntry.findUnique({ where: { id: u } });
  if (!e || e.merchant_id !== mid || e.kind !== "UDHAAR_GIVEN" || e.status !== "CONFIRMED") return null;
  const rows = await tx.khataEntry.findMany({ where: { merchant_id: mid, kind: "UDHAAR_GIVEN", status: "CONFIRMED", ...sameParty(e) }, orderBy: { created_at: "asc" } });
  return { e, rows: rows.filter((r) => open(r) > 0) };
}

export const reminderLink = (creditor_mid: string, entry_id: string) =>
  `${process.env.APP_URL ?? ""}/pay/${creditor_mid}?s=${qrSig(creditor_mid)}&u=${encodeURIComponent(entry_id)}`;

// What the pay page prefills: the outstanding (a ceiling, the payer may pay less) and who is paying.
export async function udhaarForPay(mid: string, u: string) {
  const o = await openFor(db, mid, u);
  const outstanding = o ? o.rows.reduce((s, r) => s + open(r), 0) : 0;
  if (!o || outstanding <= 0) return null;
  const payer = o.e.counterparty_mid ? (await db.merchant.findUnique({ where: { id: o.e.counterparty_mid } }))?.business_name : o.e.counterparty_name;
  return { entry_id: u, outstanding, payer: (payer ?? "").slice(0, 30) };
}

// Inside /api/pay's transaction: one khata settlement per entry paid, on both linked entries.
// settled_amount moves only if nobody else moved it first (optimistic), so two payments can't overpay.
export async function settleInTx(tx: Prisma.TransactionClient, mid: string, u: string, payment_id: string, amount: number) {
  const o = await openFor(tx, mid, u);
  const outstanding = o ? o.rows.reduce((s, r) => s + open(r), 0) : 0;
  if (!o || amount > outstanding) throw new KhataPayError(outstanding ? `Sirf ${rs(outstanding)} baaki hai.` : "Ye udhaar ab baaki nahi hai.");
  let left = amount;
  for (const r of o.rows) {
    if (!left) break;
    const take = Math.min(left, open(r));
    left -= take;
    for (const id of [r.id, ...(r.linked_entry_id ? [r.linked_entry_id] : [])]) {
      const cur = id === r.id ? r : await tx.khataEntry.findUnique({ where: { id } });
      if (!cur) continue;
      const { count } = await tx.khataEntry.updateMany({ where: { id, settled_amount: cur.settled_amount }, data: { settled_amount: { increment: take } } });
      if (!count) throw new KhataPayError("Udhaar abhi badla hai, dobara try karein.");
      await tx.khataSettlement.create({ data: { entry_id: id, payment_id, amount: take } });
    }
  }
  return { paid: amount, left: outstanding - amount, debtor_mid: o.e.counterparty_mid, debtor_name: o.e.counterparty_name ?? "", debtor_phone: o.e.counterparty_phone };
}

type Settled = Awaited<ReturnType<typeof settleInTx>>;

// After the payment: the creditor hears "<debtor> ka udhaar clear" (or what's left) next to the
// normal payment announcement, and the debtor gets a receipt. Same routing as every other send.
export async function afterSettle(creditor_mid: string, s: Settled) {
  const { say } = await import("@/agent/outreach");
  const creditor = await db.merchant.findUnique({ where: { id: creditor_mid } });
  if (!creditor) return;
  const debtor = s.debtor_mid ? await db.merchant.findUnique({ where: { id: s.debtor_mid } }) : null;
  const name = debtor?.business_name ?? s.debtor_name;
  await say(creditor, s.left ? `${name} ne ${rs(s.paid)} udhaar chukaya. Baaki ${rs(s.left)}.` : `${name} ne ${rs(s.paid)} chukaya. ${name} ka udhaar clear.`, { topic: "udhaar" });
  const receipt = `${creditor.business_name} ko ${rs(s.paid)} ka udhaar Paytm se chuka diya.${s.left ? ` Ab baaki ${rs(s.left)}.` : " Ab kuch baaki nahi."}`;
  if (debtor) await say(debtor, receipt, { topic: "udhaar" });
  else if (s.debtor_phone) await sendText(s.debtor_phone, receipt);
}

const templatesOn = () => process.env.WA_TEMPLATES === "on";

// "Gupta Sweets ko reminder bhejo". A shop goes through its claimed / demo phone; a customer through
// the phone saved with the udhaar; no phone at all means the dashboard shows the link as a QR.
export async function sendReminder(creditor_mid: string, key: string) {
  const creditor = await db.merchant.findUniqueOrThrow({ where: { id: creditor_mid } });
  const b = (await udhaarBalances(creditor_mid)).find((x) => x.key === key);
  if (!b || b.lene <= 0 || !b.remind_entry_id) throw new Error("nothing outstanding from this counterparty");
  const link = reminderLink(creditor_mid, b.remind_entry_id);
  const text = `${creditor.business_name} se ${rs(b.lene)} baaki hai. Yahan pay karein: ${link}`;
  const debtor = b.mid ? await db.merchant.findUnique({ where: { id: b.mid } }) : null;
  const phones = new Set<string>(debtor ? await phonesFor(debtor.id) : b.phone ? [b.phone] : []);
  if (debtor && process.env.DEMO_MERCHANT_PHONE && (debtor.is_demo || debtor.id === (await activeDemoMid()))) phones.add(process.env.DEMO_MERCHANT_PHONE);
  let sent = false;
  for (const phone of phones) {
    let ok = (await sendText(phone, text)).ok;
    // Outside the 24 h window only the approved template goes through (named variables, each once).
    if (!ok && templatesOn())
      ok = (await sendTemplate(phone, "udhaar_reminder", process.env.WA_TEMPLATE_LANG || "en", { name: debtor?.owner_name.split(" ")[0] ?? b.name, creditor: creditor.business_name, amount: rs(b.lene), link })).ok;
    sent ||= ok;
  }
  // The other shop's dashboard mirrors it even when no phone got it.
  if (debtor) {
    const { conversationFor, logMessage } = await import("@/agent/concierge");
    await logMessage({ conversation_id: (await conversationFor(debtor.id, "WA")).id, direction: "OUT", type: "TEXT", text });
  }
  await trace({ kind: "MESSAGE", name: sent ? "udhaar.reminder.sent" : "udhaar.reminder.mirrored", payload: { creditor_mid, counterparty: b.name, amount: b.lene, phones: phones.size } });
  return { sent, to: b.name, amount: b.lene, link, text, show_qr: !sent };
}

