import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { Channel, Merchant, MessageType } from "@/generated/prisma/client";
import { MODEL, create, runTools, textOf, wholeSentences } from "./llm";
import { CONCIERGE_SYSTEM } from "./prompts";
import { TOOLS, execTool } from "./tools";
import { trace } from "./trace";
import { istDay } from "@/engine/queries";

const HISTORY = 12;

// Backstop for the prompt rule: replies show up raw on the dashboard and get read aloud,
// so markdown emphasis and headings are stripped.
export const plain = (t: string) =>
  t.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?)]|$)/g, "$1$2").replace(/^#{1,6}\s+/gm, "").replace(/__([^_\n]+)__/g, "$1");

// Which language to answer this message in. Decided in code: the chat history pulls the model
// toward whatever language came before. ponytail: word-list heuristic for Hinglish vs English.
const HINGLISH = /\b(hai|hain|kya|kitna|kitne|kitni|mera|meri|mere|aaj|kal|ka|ki|ke|nahi|nahin|paisa|paise|batao|bataiye|aaya|aayega|hoon|karo|kar|raha|rahi|gaya|gayi|kyun|kab|kaise|bhai|ji|se|mein|ko|wala|wapas|kata|kat|bol|chahiye|hua|tha|thi)\b/i;
// Haryanvi has no STT code of its own (it transcribes as Hindi), so it is spotted by its words, in either script.
const HARYANVI = /(?:^|[^\p{L}])(mhara|mhari|mhare|mharo|thara|thari|thare|tharo|koni|ghana|ghani|ghane|kitte|kitti|tanne|manne|mhanne|thanne|ib|kad|kade|kyukar|chhora|chhori|hoya|aave|aavega|aavenge|rya|rahya|ke hoya|के होया|आवैगा|रया|म्हारा|म्हारी|म्हारे|थारा|थारी|थारे|कोनी|घणा|घणी|घणे|कित्ते|तन्नै|मन्नै|इब|कद|छोरा)(?=$|[^\p{L}])/giu;
// One Haryanvi word in Devanagari is enough; in Latin script "ghana" alone could be English, so
// it takes two Haryanvi words, or one alongside ordinary Hindi words.
const isHaryanvi = (t: string) => {
  const hits = t.match(HARYANVI)?.length ?? 0;
  return /[\u0900-\u097F]/.test(t) ? hits >= 1 : hits >= 2 || (hits === 1 && HINGLISH.test(t));
};
// WhatsApp messages are always in Latin letters (the user's call): "hi" is written as Hinglish.
export const waLang = (l: string | null | undefined) => (l === "hi" ? "hinglish" : l);
export const LANGS: Record<string, string> = {
  hi: "Hinglish (Hindi in Latin letters)",
  hinglish: "Hinglish (Hindi in Latin letters)",
  en: "English",
  haryanvi: "Haryanvi (light and respectful, in Latin letters)",
};
// TTS voice for a chosen language; Haryanvi and Hinglish are spoken by the Hindi voice.
export const ttsLang = (l: string | null | undefined) => (l === "en" ? "en" : l === "hi" ? "hi" : "hinglish") as "hi" | "hinglish" | "en";

export function replyLanguage(text: string, o: { spoken?: string; profile: string }) {
  const hindiScript = "Hinglish (Hindi in Latin letters)";
  if (isHaryanvi(text)) return "Haryanvi (light and respectful, in the same script the merchant used)";
  if (/[\u0900-\u097F]/.test(text)) return hindiScript;
  if (!/[a-z]/i.test(text)) return o.profile === "en" ? "English" : hindiScript;
  // English only when the whole message is English. Voice arrives romanised, so a spoken
  // Hindi sentence answers in the merchant's usual script.
  if (!HINGLISH.test(text)) return "English";
  return o.spoken ? hindiScript : "Hinglish (Hindi in Latin letters)";
}

export async function conversationFor(merchant_id: string, channel: Channel) {
  const c = await db.conversation.findFirst({ where: { merchant_id, channel }, orderBy: { opened_at: "desc" } });
  return c ?? db.conversation.create({ data: { merchant_id, channel } });
}

export async function logMessage(m: {
  conversation_id: string;
  direction: "IN" | "OUT";
  type: MessageType;
  text?: string | null;
  transcript?: string | null;
  media_url?: string | null;
  wamid?: string | null;
  audience?: "MERCHANT" | "OPS";
}) {
  const row = await db.message.create({ data: { audience: "MERCHANT", ...m } });
  if (m.direction === "IN") await db.conversation.update({ where: { id: m.conversation_id }, data: { last_inbound_at: new Date() } });
  return row;
}

// One merchant turn. The caller has already logged the inbound message.
export async function converse(o: {
  merchant: Merchant;
  conversation_id: string;
  text: string;
  voice?: boolean;
  spoken?: string; // STT language code for voice notes, e.g. "en-IN"
  language?: string | null; // chosen on WhatsApp; overrides per-message detection
  image?: { base64: string; mime: string; url: string } | null;
}) {
  const past = await db.message.findMany({
    where: { conversation_id: o.conversation_id, audience: "MERCHANT" },
    orderBy: { created_at: "desc" },
    take: HISTORY + 1,
  });
  // Drop the just-logged inbound (it's re-sent below with its image) and rebuild alternating turns.
  const history: Anthropic.MessageParam[] = [];
  for (const m of past.slice(1).reverse()) {
    const content = m.transcript ?? m.text;
    if (!content) continue;
    const role = m.direction === "IN" ? "user" : "assistant";
    const last = history.at(-1);
    if (last?.role === role) last.content = `${last.content}\n${content}`;
    else history.push({ role, content });
  }
  if (history[0]?.role === "assistant") history.unshift({ role: "user", content: "(conversation resumed)" });

  // Volatile facts go in the user turn, after the cached system prompt and tools.
  const context = `[Merchant: ${o.merchant.owner_name}, ${o.merchant.business_name}, ${o.merchant.city}. Profile language: ${o.merchant.language}. Today (IST): ${istDay()}.${o.voice ? " This message was a voice note; your reply will be spoken." : ""} Reply in: ${(o.language && LANGS[o.language]) || replyLanguage(o.text, { spoken: o.spoken, profile: o.merchant.language })}${o.language ? " (the merchant chose this; never switch unless they ask)" : ""}.]`;
  const content: Anthropic.ContentBlockParam[] = [];
  if (o.image) content.push({ type: "image", source: { type: "base64", media_type: o.image.mime as "image/jpeg", data: o.image.base64 } });
  content.push({ type: "text", text: `${context}\n${o.text || (o.image ? "(photo)" : "")}` });
  if (history.at(-1)?.role === "user") history.push({ role: "assistant", content: "Ji." });

  await trace({ kind: "THINK", name: "concierge.turn", conversation_id: o.conversation_id, payload: { text: o.text, voice: !!o.voice, image: !!o.image } });
  const r = await runTools({
    model: MODEL.converse(),
    system: CONCIERGE_SYSTEM,
    tools: TOOLS,
    messages: [...history, { role: "user", content }],
    exec: (name, input) => execTool(name, input, { merchant_id: o.merchant.id, conversation_id: o.conversation_id, image: o.image ? { url: o.image.url } : null }),
    ids: { conversation_id: o.conversation_id },
  });
  let reply = plain(r.text) || "Maaf kijiye, abhi jawab nahi de paaya. Thodi der mein phir try karein.";
  // A long chat history can pull the model back into its usual script. The chosen language is a
  // promise to the merchant, so a wrong-script reply is rewritten once (facts unchanged).
  const wantDeva = false; // never Devanagari on WhatsApp
  const hasDeva = /[\u0900-\u097F]/.test(reply);
  if (r.text && (wantDeva !== hasDeva || (o.language === "en" && HINGLISH.test(reply)))) {
    const fix = await create({
      model: MODEL.converse(),
      max_tokens: 2048,
      output_config: { effort: "low" }, // a straight rewrite; thinking would only eat the budget
      system: "Rewrite the message in the requested language and script. Keep every fact, number, ₹ amount, date and time exactly as written. Plain text, no markdown. Output only the rewritten message.",
      messages: [{ role: "user", content: `Language: ${LANGS[o.language ?? "hinglish"] ?? LANGS.hinglish}\n\nMessage:\n${reply}` }],
    });
    reply = plain(fix.stop_reason === "max_tokens" ? wholeSentences(textOf(fix)) : textOf(fix)) || reply;
    await trace({ kind: "THINK", name: "language.rewrite", conversation_id: o.conversation_id, payload: { to: o.language } });
  }
  await trace({ kind: "MESSAGE", name: "concierge.reply", conversation_id: o.conversation_id, payload: { text: reply, stop: r.stop } });
  return reply;
}
