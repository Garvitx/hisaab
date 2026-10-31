// Routes one inbound WhatsApp message by sender (CLAUDE.md section 9).
import { fetchMedia, parseInbound, samePhone, sendText, sendVoice, uploadPublicMedia, type Inbound } from "@/channels/whatsapp";
import { stt } from "@/channels/voice";
import { approveAction, rejectAction } from "@/engine/actions";
import * as merchants from "@/systems/merchants";
import { converse, conversationFor, logMessage } from "./concierge";
import { notifyDecision } from "./outreach";
import { trace } from "./trace";

const lang = (l: string) => (l === "en" ? "en" : l === "hi" ? "hi" : "hinglish") as "hi" | "hinglish" | "en";

export async function handleInbound({ msg }: Inbound) {
  if (typeof msg?.from !== "string" || !msg.from) return;
  if (samePhone(msg.from, process.env.OPS_EMPLOYEE_PHONE)) return ops(msg.from, parseInbound(msg));

  const merchant = (await merchants.list()).find((m) => samePhone(m.phone, msg.from));
  // The number is public, so strangers will message it.
  if (!merchant) return void (await sendText(msg.from, "Namaste! Yeh number abhi sirf registered Paytm merchants ke liye hai."));

  const p = parseInbound(msg);
  const conv = await conversationFor(merchant.id, "WA");
  let text = "";
  let voice = false;
  let image: { base64: string; mime: string; url: string } | null = null;

  if (p.kind === "text") text = p.text;
  else if (p.kind === "button") text = p.title;
  else if (p.kind === "voice") {
    const media = await fetchMedia(p.mediaId);
    const [heard, url] = await Promise.all([stt(media.buf, media.mime), uploadPublicMedia(media.buf, media.mime, `${msg.id}.ogg`).catch(() => null)]);
    text = heard.text;
    voice = true;
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

  const reply = await converse({ merchant, conversation_id: conv.id, text, voice, image });

  // Voice in → voice note plus the same text (CLAUDE.md section 9). Only the demo merchant has a real phone.
  if (voice) {
    const v: { ok: boolean; wamid?: string; error?: string; link?: string } = await sendVoice(merchant.phone, reply, lang(merchant.language)).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (v.ok) await logMessage({ conversation_id: conv.id, direction: "OUT", type: "VOICE", text: reply, media_url: v.link, wamid: v.wamid });
    else console.error("[wa] voice reply failed", v.error);
  }
  const sent = await sendText(merchant.phone, reply);
  await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text: reply, wamid: sent.wamid });
}

// The ops phone approves or rejects with the buttons on an approval request.
async function ops(from: string, p: ReturnType<typeof parseInbound>) {
  const m = p.kind === "button" ? /^(approve|reject):(.+)$/.exec(p.id) : null;
  if (!m) return void (await sendText(from, "Hisaab ops: approval requests will arrive here with Approve / Reject buttons."));
  const [, verb, id] = m;
  try {
    const d = { decided_by: "ops-whatsapp", via: "WHATSAPP" as const };
    const a = verb === "approve" ? await approveAction(id, d) : await rejectAction(id, d);
    await sendText(from, `${verb === "approve" ? "Approved" : "Rejected"}: ${a.type.replace(/_/g, " ")}${a.amount ? ` ₹${a.amount.toLocaleString("en-IN")}` : ""}. The merchant is being informed.`);
    await notifyDecision(a.id);
  } catch (e) {
    await sendText(from, `Could not ${verb}: ${(e as Error).message}`);
  }
}
