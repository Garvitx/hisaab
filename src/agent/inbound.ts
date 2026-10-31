// Routes one inbound WhatsApp message by sender (CLAUDE.md section 9).
import { fetchMedia, parseInbound, samePhone, sendButtons, sendText, sendVoice, uploadPublicMedia, type Inbound } from "@/channels/whatsapp";
import { stt } from "@/channels/voice";
import { approveAction, rejectAction } from "@/engine/actions";
import * as merchants from "@/systems/merchants";
import { activeDemoMid } from "@/lib/demo";
import { converse, conversationFor, logMessage, ttsLang } from "./concierge";
import { db } from "@/lib/db";
import { notifyDecision } from "./outreach";
import { trace } from "./trace";

const CHANGE = /^\s*(change language|language|bhasha badlo|bhasha badliye|bhasha|भाषा बदलो|भाषा)\s*[.!?]*\s*$/i;
const PICKED: Record<string, string> = {
  hi: "Theek hai, ab se Hinglish mein baat karenge.",
  hinglish: "Theek hai, ab se Hinglish mein baat karenge.",
  en: "Great, I'll reply in English from now on.",
  haryanvi: "Thik sai, ib te Haryanvi mein baat karange.",
};

// First chat (or "change language"): ask once, with buttons, and hold their question meanwhile.
async function askLanguage(to: string, owner: string, conversation_id: string) {
  const body = `Namaste ${owner} ji! Main Hisaab hoon, aapka Paytm Business saathi.\nAap kis bhasha mein baat karna chahenge? Which language would you like to chat in?`;
  const r = await sendButtons(to, body, [{ id: "lang:hinglish", title: "Hinglish" }, { id: "lang:en", title: "English" }, { id: "lang:haryanvi", title: "Haryanvi" }]);
  await logMessage({ conversation_id, direction: "OUT", type: "BUTTONS", text: body, wamid: r.wamid });
}

export async function handleInbound({ msg }: Inbound) {
  if (typeof msg?.from !== "string" || !msg.from) return;
  if (samePhone(msg.from, process.env.OPS_EMPLOYEE_PHONE)) return ops(msg.from, parseInbound(msg));

  // The demo phone speaks as whichever merchant the switcher picked; other merchants match by phone.
  const merchant = samePhone(msg.from, process.env.DEMO_MERCHANT_PHONE)
    ? await merchants.get(await activeDemoMid())
    : (await merchants.list()).find((m) => samePhone(m.phone, msg.from));
  // The number is public, so strangers will message it.
  if (!merchant) return void (await sendText(msg.from, "Namaste! Yeh number abhi sirf registered Paytm merchants ke liye hai."));

  const p = parseInbound(msg);
  const conv = await conversationFor(merchant.id, "WA");
  let text = "";
  let voice = false;
  let spoken: string | undefined;
  let image: { base64: string; mime: string; url: string } | null = null;

  if (p.kind === "text") text = p.text;
  else if (p.kind === "button") text = p.title;
  else if (p.kind === "voice") {
    const media = await fetchMedia(p.mediaId);
    const [heard, url] = await Promise.all([stt(media.buf, media.mime), uploadPublicMedia(media.buf, media.mime, `${msg.id}.ogg`).catch(() => null)]);
    text = heard.text;
    voice = true;
    spoken = heard.language;
    await logMessage({ conversation_id: conv.id, direction: "IN", type: "VOICE", transcript: text, media_url: url, wamid: msg.id });
    await trace({ kind: "TOOL_RESULT", name: "stt", conversation_id: conv.id, payload: { transcript: text, language: heard.language } });
  } else if (p.kind === "image") {
    const media = await fetchMedia(p.mediaId);
    const mime = media.mime.split(";")[0];
    const url = await uploadPublicMedia(media.buf, mime, `${msg.id}.${mime.split("/")[1] || "jpg"}`);
    image = { base64: media.buf.toString("base64"), mime, url };
    text = p.caption;
    await logMessage({ conversation_id: conv.id, direction: "IN", type: "IMAGE", text: p.caption || null, media_url: url, wamid: msg.id });
  } else {
    return void (await sendText(msg.from, "Abhi main text, voice note aur photo samajh sakta hoon. Kripya inmein se bhejein."));
  }
  if (p.kind === "text" || p.kind === "button") await logMessage({ conversation_id: conv.id, direction: "IN", type: "TEXT", text, wamid: msg.id });

  // Language: chosen once per chat, then fixed. A button tap or "Haryanvi" sets it; "change language" asks again.
  let language = conv.language;
  const picked = p.kind === "button" && p.id.startsWith("lang:") ? p.id.slice(5) : /^\s*haryanvi\s*[.!]*\s*$/i.test(text) ? "haryanvi" : null;
  if (picked) {
    language = picked;
    const held = conv.pending_text;
    await db.conversation.update({ where: { id: conv.id }, data: { language, pending_text: null } });
    if (!held) {
      const ok = PICKED[language] ?? PICKED.hinglish;
      const sent = await sendText(msg.from, ok);
      return void (await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text: ok, wamid: sent.wamid }));
    }
    text = held; // now answer the question they asked first
  } else if (CHANGE.test(text) || !language) {
    if (!language && text) await db.conversation.update({ where: { id: conv.id }, data: { pending_text: text } });
    return askLanguage(msg.from, merchant.owner_name.split(" ")[0], conv.id);
  }

  const reply = await converse({ merchant, conversation_id: conv.id, text, voice, spoken, image, language });

  // Voice in → voice note plus the same text (CLAUDE.md section 9). Only the demo merchant has a real phone.
  if (voice) {
    const v: { ok: boolean; wamid?: string; error?: string; link?: string } = await sendVoice(msg.from, reply, ttsLang((await db.conversation.findUnique({ where: { id: conv.id }, select: { language: true } }))?.language ?? language)).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (v.ok) await logMessage({ conversation_id: conv.id, direction: "OUT", type: "VOICE", text: reply, media_url: v.link, wamid: v.wamid });
    else console.error("[wa] voice reply failed", v.error);
  }
  const sent = await sendText(msg.from, reply);
  await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text: reply, wamid: sent.wamid });
}

// The ops phone approves or rejects with the buttons on an approval request.
async function ops(from: string, p: ReturnType<typeof parseInbound>) {
  const m = p.kind === "button" ? /^(approve|reject):(.+)$/.exec(p.id) : null;
  if (!m) return void (await sendText(from, "Hisaab ops: approval requests will arrive here with Approve / Reject buttons."));
  const [, verb, id] = m;
  // Stale buttons are normal: a reset wipes actions, and the dashboard may have decided it first.
  const action = await db.action.findUnique({ where: { id } });
  if (!action) return void (await sendText(from, "This request is no longer open (the demo was reset or it was removed). Nothing was changed."));
  if (action.status !== "PENDING")
    return void (await sendText(from, `Already decided: ${action.type.replace(/_/g, " ")} is ${action.status.toLowerCase()}${action.decided_via ? ` (via ${action.decided_via.toLowerCase()})` : ""}. Nothing was changed.`));
  try {
    const d = { decided_by: "ops-whatsapp", via: "WHATSAPP" as const };
    const a = verb === "approve" ? await approveAction(id, d) : await rejectAction(id, d);
    await sendText(from, `${verb === "approve" ? "Approved" : "Rejected"}: ${a.type.replace(/_/g, " ")}${a.amount ? ` ₹${a.amount.toLocaleString("en-IN")}` : ""}. The merchant is being informed.`);
    await notifyDecision(a.id);
  } catch (e) {
    // Never show raw errors on WhatsApp; the detail goes to the logs.
    console.error("[wa] ops decision failed", id, (e as Error)?.message || e);
    await sendText(from, `Could not ${verb} this one right now. Please use the ops dashboard.`);
  }
}
