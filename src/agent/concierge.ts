import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { Channel, Merchant, MessageType } from "@/generated/prisma/client";
import { MODEL, runTools } from "./llm";
import { CONCIERGE_SYSTEM } from "./prompts";
import { TOOLS, execTool } from "./tools";
import { trace } from "./trace";
import { istDay } from "@/engine/queries";

const HISTORY = 12;

// Backstop for the prompt rule: replies show up raw on the dashboard and get read aloud,
// so markdown emphasis and headings are stripped.
export const plain = (t: string) =>
  t.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?)]|$)/g, "$1$2").replace(/^#{1,6}\s+/gm, "").replace(/__([^_\n]+)__/g, "$1");

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
  const context = `[Merchant: ${o.merchant.owner_name}, ${o.merchant.business_name}, ${o.merchant.city}. Language: ${o.merchant.language}. Today (IST): ${istDay()}.${o.voice ? " This message was a voice note; your reply will be spoken." : ""}]`;
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
  const reply = plain(r.text) || "Maaf kijiye, abhi jawab nahi de paaya. Thodi der mein phir try karein.";
  await trace({ kind: "MESSAGE", name: "concierge.reply", conversation_id: o.conversation_id, payload: { text: reply, stop: r.stop } });
  return reply;
}
