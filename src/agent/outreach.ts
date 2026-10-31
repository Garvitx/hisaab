// Proactive messages: after detection, after a decision. Every send is mirrored to
// hisaab.messages (the dashboard reads it) and traced.
import { db } from "@/lib/db";
import type { Merchant } from "@/generated/prisma/client";
import { sendButtons, sendText, sendVoice } from "@/channels/whatsapp";
import { conversationFor, logMessage, plain, ttsLang } from "./concierge";
import { approvalMessage, merchantMessage } from "./notifier";
import { trace } from "./trace";
import { activeDemoMid } from "@/lib/demo";

// The language the merchant picked in chat, else their profile language.
const chosen = async (m: Merchant) => (await conversationFor(m.id, "WA")).language ?? m.language;

// Real sends only ever go to the demo phone: for the seeded demo merchant, and for whichever
// merchant the switcher has the phone acting as. The other merchants' numbers are generated
// and may belong to strangers, so they get a dashboard-only mirror.
export async function say(m: Merchant, raw: string, o: { voice?: boolean; case_id?: string } = {}) {
  const text = plain(raw);
  const conv = await conversationFor(m.id, "WA");
  let wamid: string | undefined;
  const phone = process.env.DEMO_MERCHANT_PHONE;
  if (phone && (m.is_demo || m.id === (await activeDemoMid()))) {
    if (o.voice) {
      const v: { ok: boolean; wamid?: string; link?: string } = await sendVoice(phone, text, ttsLang(conv.language ?? m.language)).catch(() => ({ ok: false }));
      if (v.ok) await logMessage({ conversation_id: conv.id, direction: "OUT", type: "VOICE", text, media_url: v.link, wamid: v.wamid });
    }
    wamid = (await sendText(phone, text)).wamid;
  }
  await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text, wamid });
  await trace({ kind: "MESSAGE", name: wamid ? "whatsapp.sent" : "message.mirrored", case_id: o.case_id, conversation_id: conv.id, payload: { text, voice: !!o.voice } });
}

const sumBy = (xs: { amount: number | null }[]) => xs.reduce((s, x) => s + (x.amount ?? 0), 0);

export async function notifyCase(case_id: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: case_id }, include: { findings: true, actions: true } });
  const m = await db.merchant.findUniqueOrThrow({ where: { id: c.merchant_id } });
  const verified = c.findings.filter((f) => f.verified);
  const found = verified.map((f) => f.title).join("; ");
  // Money actions carry the finding amount; close_subscription etc. repeat it, so count each finding once.
  const fixed = verified.filter((f) => c.actions.some((a) => a.finding_id === f.id && a.status === "EXECUTED" && (a.type === "reverse_charge" || a.type === "reverse_deduction")));
  const pending = c.actions.filter((a) => a.status === "PENDING");

  let outcome: Parameters<typeof merchantMessage>[0]["outcome"] = "fixed";
  let detail: string | undefined;
  if (c.status === "AWAITING_MERCHANT") {
    outcome = "warning";
    detail = "Ask ONE clear yes/no question: did the Paytm courier actually take the device away? Explain that rent is still being charged.";
  } else if (c.status === "ESCALATED") outcome = "escalated";
  else if (pending.length) outcome = "awaiting_approval";
  else if (!fixed.length) outcome = "warning";

  const amounts: Record<string, number> = {};
  if (fixed.length) amounts.refunded = sumBy(fixed);
  const pendingFindings = verified.filter((f) => pending.some((a) => a.finding_id === f.id));
  if (pendingFindings.length) amounts.under_review = sumBy(pendingFindings);
  if (!fixed.length && !pendingFindings.length && verified.length) amounts.amount = sumBy(verified);

  const text = await merchantMessage({ merchant: { name: m.owner_name, language: await chosen(m) }, found, outcome, amounts, detail });
  await say(m, text, { voice: true, case_id });

  for (const a of pending.filter((a) => a.tier === "APPROVAL")) await requestApproval(a.id);
}

export async function requestApproval(action_id: string) {
  const a = await db.action.findUniqueOrThrow({ where: { id: action_id }, include: { finding: true, case: true } });
  const m = await db.merchant.findUniqueOrThrow({ where: { id: a.case.merchant_id } });
  const text = await approvalMessage({
    merchant: m.business_name,
    mid: m.id,
    issue: a.finding?.title ?? a.case.summary,
    evidence: a.finding ? `${a.finding.origin === "HUNTER" ? "Found by the AI hunter" : "Rule engine"}, ${a.finding.evidence_source === "MERCHANT_CLAIM" ? "based on the merchant's confirmation" : "verified from the ledger"}` : "",
    fix: a.type.replace(/_/g, " "),
    amount: a.amount ?? 0,
    reason: a.finding?.evidence_source === "MERCHANT_CLAIM" ? "evidence is the merchant's word" : "amount is above the auto-fix limit",
  });
  const ops = process.env.OPS_EMPLOYEE_PHONE;
  if (ops) await sendButtons(ops, text, [{ id: `approve:${a.id}`, title: "Approve" }, { id: `reject:${a.id}`, title: "Reject" }]);
  await trace({ kind: "MESSAGE", name: "approval.requested", case_id: a.case_id, payload: { action_id: a.id, text, sent: !!ops } });
}

// After approve / reject / undo, from either channel.
export async function notifyDecision(action_id: string) {
  const a = await db.action.findUniqueOrThrow({ where: { id: action_id }, include: { finding: true, case: true } });
  const m = await db.merchant.findUniqueOrThrow({ where: { id: a.case.merchant_id } });
  // close_subscription rides along with a refund; one message per decision is enough.
  if (a.type === "close_subscription" || a.type === "close_loan") return;
  const outcome = a.status === "UNDONE" ? "undone" : a.status === "REJECTED" ? "rejected" : "fixed";
  const text = await merchantMessage({
    merchant: { name: m.owner_name, language: await chosen(m) },
    found: a.finding?.title ?? a.case.summary,
    outcome,
    amounts: a.amount ? { [outcome === "fixed" ? "refunded" : "amount"]: a.amount } : {},
    detail: outcome === "rejected" ? "A Paytm specialist reviewed it and could not approve the refund; they will follow up." : outcome === "undone" ? "The earlier refund was reversed after review." : undefined,
  });
  await say(m, text, { case_id: a.case_id });
}
