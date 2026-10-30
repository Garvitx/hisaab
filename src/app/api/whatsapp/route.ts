import { NextResponse, after } from "next/server";
import { messagesIn, sendText, signatureOk, samePhone, type Inbound } from "@/channels/whatsapp";

export const maxDuration = 60;

// Chakra owns the Meta app and did the verify handshake already; this is insurance.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = process.env.CHAKRA_WEBHOOK_SECRET;
  if (token && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function POST(req: Request) {
  // RAW string: the HMAC is over exactly these bytes.
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-chakra-signature-256"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let messages: Inbound[] = [];
  try {
    messages = messagesIn(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // ponytail: echo only (9:30 slot). wa_inbox persistence and the concierge
  // replace handle() once the schemas land.
  if (messages.length) after(() => Promise.all(messages.slice(0, 5).map(handle)));

  // Always 200 fast: a slow or non-200 ack makes Chakra retry the whole batch.
  return NextResponse.json({ ok: true });
}

async function handle({ msg, contactName }: Inbound) {
  try {
    if (typeof msg?.from !== "string" || !msg.from) return;
    const who = samePhone(msg.from, process.env.OPS_EMPLOYEE_PHONE)
      ? "ops"
      : samePhone(msg.from, process.env.DEMO_MERCHANT_PHONE)
        ? "merchant"
        : null;

    // The number is printed on webight.com, so strangers WILL message it.
    if (!who) {
      await sendText(msg.from, "Namaste! Yeh number abhi sirf registered Paytm merchants ke liye hai.");
      return;
    }

    const text = (msg as { text?: { body?: string } }).text?.body;
    await sendText(msg.from, `Hisaab echo (${who}${contactName ? `, ${contactName}` : ""}): ${text ?? `[${msg.type}]`}`);
  } catch (err) {
    console.error("[wa] handle failed", (err as Error)?.message || err);
  }
}
