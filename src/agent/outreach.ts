// Proactive messages: after detection, after a decision. Every send is mirrored to
// hisaab.messages (the dashboard reads it) and traced.
import { db } from "@/lib/db";
import type { Merchant } from "@/generated/prisma/client";
import { sendButtons, sendTemplate, sendText, sendVoice } from "@/channels/whatsapp";
import { conversationFor, logMessage, plain, ttsLang, waLang } from "./concierge";
import { approvalMessage, merchantMessage } from "./notifier";
import { trace } from "./trace";
import { activeDemoMid } from "@/lib/demo";
import { phonesFor } from "@/lib/claims";

// The language the merchant picked in chat, else their profile language.
const chosen = async (m: Merchant) => waLang((await conversationFor(m.id, "WA")).language ?? m.language)!;

// Outside a phone's 24 h window WhatsApp refuses free-form messages; the approved templates still go
// through. Off until Meta approves them (WA_TEMPLATES=on), so a failed send stays a logged failure.
const templatesOn = () => process.env.WA_TEMPLATES === "on";
const templateLang = () => process.env.WA_TEMPLATE_LANG || "en";

// Real sends only go to phones that opted in: the host's demo phone (for the seeded demo merchant
// or whichever shop the switcher picked) and judges who claimed a shop and verified their number.
// The seeded merchants' own numbers are generated and may belong to strangers: mirror only.
export async function say(m: Merchant, raw: string, o: { voice?: boolean; case_id?: string; topic?: string } = {}) {
  const text = plain(raw);
  const conv = await conversationFor(m.id, "WA");
  let wamid: string | undefined;
  const demo = process.env.DEMO_MERCHANT_PHONE;
  const to = new Set(await phonesFor(m.id));
  if (demo && (m.is_demo || m.id === (await activeDemoMid()))) to.add(demo);
  for (const phone of to) {
    if (o.voice) {
      const v: { ok: boolean; wamid?: string; link?: string } = await sendVoice(phone, text, ttsLang(conv.language ?? m.language), { case_id: o.case_id }).catch(() => ({ ok: false }));
      if (v.ok) await logMessage({ conversation_id: conv.id, direction: "OUT", type: "VOICE", text, media_url: v.link, wamid: v.wamid });
    }
    const sent = await sendText(phone, text);
    if (sent.ok) wamid = sent.wamid ?? wamid;
    else if (templatesOn()) {
      // hisaab_alert: "Namaste {{name}}, aapke Paytm Business account mein {{topic}} ka ek update hai: {{details}}. ..."
      const t = await sendTemplate(phone, "hisaab_alert", templateLang(), { name: m.owner_name.split(" ")[0], topic: o.topic ?? "account", details: text });
      if (t.ok) wamid = t.wamid ?? wamid;
      await trace({ kind: "MESSAGE", name: t.ok ? "template.sent" : "template.failed", case_id: o.case_id, payload: { template: "hisaab_alert", phone_tail: phone.slice(-4) } });
    }
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
  const checks = new Set(verified.map((f) => f.check));
  if (checks.has("payment_velocity")) {
    outcome = "warning";
    detail = "One customer made many tiny payments (₹10 or less) within a few minutes. That is how fraudsters test a QR or a stolen card before a big payment. Tell the merchant: don't hand over goods against a big payment from this customer until it shows in their Paytm app; no money was lost.";
  } else if (checks.has("payments_stopped")) {
    outcome = "warning";
    detail = "Payments to this shop suddenly stopped for over 2 hours although usually many come in by now. Tell the merchant to check their QR standee right away in case someone pasted another QR over it, and ask customers to confirm the shop name shown before paying; reply here to get a new standee.";
  } else if (c.status === "AWAITING_MERCHANT") {
    outcome = "warning";
    detail = "Ask ONE clear yes/no question: did the Paytm courier actually take the device away? Explain that rent is still being charged.";
  } else if (c.status === "ESCALATED") outcome = "escalated";
  else if (pending.length) outcome = "awaiting_approval";
  else if (!fixed.length) outcome = "warning";

  const amounts: Record<string, number> = {};
  const warnOnly = checks.has("payment_velocity") || checks.has("payments_stopped");
  if (fixed.length) amounts.refunded = sumBy(fixed);
  const pendingFindings = verified.filter((f) => pending.some((a) => a.finding_id === f.id));
  if (pendingFindings.length) amounts.under_review = sumBy(pendingFindings);
  if (!fixed.length && !pendingFindings.length && verified.length && !warnOnly) amounts.amount = sumBy(verified);
  if (checks.has("payment_velocity")) amounts.tiny_payments_total = sumBy(verified.filter((f) => f.check === "payment_velocity"));

  const text = await merchantMessage({ merchant: { name: m.owner_name, language: await chosen(m) }, found, outcome, amounts, detail }, { role: "NOTIFIER", case_id });
  await say(m, text, { voice: true, case_id, topic: verified[0]?.check.replace(/_/g, " ") });

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
    reason: await approvalReason(a),
  }, { role: "NOTIFIER", case_id: a.case_id });
  const ops = process.env.OPS_EMPLOYEE_PHONE;
  let sent = false;
  if (ops) {
    const ref = a.case_id.slice(-6);
    sent = (await sendButtons(ops, `${text}\n\nCase ${ref}: tap below, or reply APPROVE ${ref} / REJECT ${ref}.`, [{ id: `approve:${a.id}`, title: "Approve" }, { id: `reject:${a.id}`, title: "Reject" }])).ok;
    if (!sent && templatesOn()) {
      // hisaab_approval: "... Case {{case_ref}}. Tap Approve or Reject below." + quick replies (typed APPROVE <ref> also works).
      sent = (await sendTemplate(ops, "hisaab_approval", templateLang(), { business: m.business_name, mid: m.id, issue: a.finding?.title ?? a.case.summary, amount: `Rs ${(a.amount ?? 0).toLocaleString("en-IN")}`, case_ref: a.case_id.slice(-6) }, [`approve:${a.id}`, `reject:${a.id}`])).ok;
    }
  }
  await trace({ kind: "MESSAGE", name: "approval.requested", case_id: a.case_id, payload: { action_id: a.id, text, sent } });
}

// The real policy reason, as recorded when the action was proposed (never a guess).
async function approvalReason(a: { id: string; case_id: string; finding: { verified: boolean; evidence_source: string } | null; amount: number | null }) {
  if (a.finding?.evidence_source === "MERCHANT_CLAIM") return "the evidence is the merchant's word";
  if (a.finding && !a.finding.verified) return "the AI hunter's finding could not be verified from the ledger";
  const p = await db.traceEvent.findFirst({ where: { case_id: a.case_id, kind: "POLICY", payload: { path: ["action_id"], equals: a.id } }, select: { payload: true } });
  const pl = (p?.payload ?? {}) as { reason?: string; auto_limit?: number };
  return pl.reason ?? (pl.auto_limit != null ? `amount is above the auto-fix limit of ₹${pl.auto_limit.toLocaleString("en-IN")}` : "policy requires a human");
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
  }, { role: "NOTIFIER", case_id: a.case_id });
  await say(m, text, { case_id: a.case_id });
}
