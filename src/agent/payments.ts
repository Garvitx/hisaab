// After every shop-QR payment: the claimed phone gets the Soundbox moment on WhatsApp, a text plus
// "Paytm par ₹X prapt hue" as a voice note. Mirrored to the shop's WA chat for the dashboard.
import { db } from "@/lib/db";
import { phonesFor } from "@/lib/claims";
import { sendAudio, sendText, uploadPublicMedia } from "@/channels/whatsapp";
import { tts } from "@/channels/voice";
import { conversationFor, logMessage } from "./concierge";

export const soundboxLine = (amount: number) => `Paytm par ₹${amount} prapt hue`;

// One TTS + upload per amount, like the dashboard's announce cache.
// ponytail: per instance; at most 5,000 entries (the pay cap), which is fine.
const voiceLinks = new Map<number, Promise<string>>();
const voiceLink = (amount: number) => {
  let p = voiceLinks.get(amount);
  if (!p) {
    p = tts(soundboxLine(amount), "hi").then((buf) => uploadPublicMedia(buf, "audio/ogg", `soundbox-${amount}.ogg`));
    p.catch(() => voiceLinks.delete(amount)); // a failure must not stick
    voiceLinks.set(amount, p);
  }
  return p;
};

export async function onPayment(payment_id: string): Promise<void> {
  const p = await db.payment.findUnique({ where: { id: payment_id }, select: { merchant_id: true, amount: true, payer_name: true, status: true } });
  if (!p || p.status !== "SUCCESS") return;
  const phones = await phonesFor(p.merchant_id);
  if (!phones.length) return;
  const conv = await conversationFor(p.merchant_id, "WA");
  const text = `₹${p.amount.toLocaleString("en-IN")} received from ${p.payer_name || "a customer"}`;
  const link = await voiceLink(p.amount).catch((e) => (console.error("[pay] soundbox voice failed", (e as Error)?.message || e), null));
  for (const phone of phones) {
    const sent = await sendText(phone, text);
    await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text, wamid: sent.wamid });
    if (!link) continue;
    const v = await sendAudio(phone, link);
    await logMessage({ conversation_id: conv.id, direction: "OUT", type: "VOICE", text: soundboxLine(p.amount), media_url: link, wamid: v.wamid });
  }
}
