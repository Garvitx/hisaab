// What a phone hears after JOIN: who they are now, what to try, and their shop's QR as an image.
import QRCode from "qrcode";
import type { Merchant } from "@/generated/prisma/client";
import { sendImage, sendText, uploadPublicMedia } from "@/channels/whatsapp";
import { payUrl } from "@/lib/qr-sig";
import { conversationFor, logMessage } from "./concierge";

const TRY = `Try kariye:\n- "Aaj ka hisaab batao"\n- "Soundbox bol nahi raha"\n- Kisi bill ki photo bhejiye`;

export function joinText(m: Pick<Merchant, "business_name" | "city" | "owner_name">, already: boolean, name: string | null) {
  const hi = name ? ` ${name}` : "";
  return already
    ? `Namaste${hi}! Aap pehle se ${m.business_name} (${m.city}) ke maalik hain, ${m.owner_name} ke naam se.\n\n${TRY}`
    : `Swagat hai${hi}! Ab aap ${m.owner_name} hain, ${m.business_name} (${m.city}) ke maalik. Ye demo dukaan hai, asli paisa nahi lagta.\n\n${TRY}\n\nNeeche aapki dukaan ka QR hai: koi bhi scan karke pay kare, aapko yahin message aayega.`;
}

// ponytail: per instance, so a cold start re-uploads once per shop. The signed URL never changes per mid.
const qrLinks = new Map<string, string>();

export async function sendShopQr(to: string, m: Merchant) {
  let link = qrLinks.get(m.id);
  if (!link) {
    // Hex, not tokens: qrcode needs literal colours. Navy #002E6E is --color-navy.
    const png = await QRCode.toBuffer(payUrl(m.id), { type: "png", width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });
    link = await uploadPublicMedia(png, "image/png", `qr-${m.id}.png`);
    qrLinks.set(m.id, link);
  }
  const caption = `Ye aapki dukaan ka QR hai: ${m.business_name}`;
  const r = await sendImage(to, link, caption);
  await logMessage({ conversation_id: (await conversationFor(m.id, "WA")).id, direction: "OUT", type: "IMAGE", text: caption, media_url: link, wamid: r.wamid });
  return r;
}

export async function welcome(to: string, m: Merchant, already: boolean, name: string | null) {
  const text = joinText(m, already, name);
  const sent = await sendText(to, text);
  await logMessage({ conversation_id: (await conversationFor(m.id, "WA")).id, direction: "OUT", type: "TEXT", text, wamid: sent.wamid });
  // The QR is a bonus: an upload failure must not cost them the language buttons that follow.
  await sendShopQr(to, m).catch((e) => console.error("[join] qr failed", m.id, (e as Error)?.message || e));
}
