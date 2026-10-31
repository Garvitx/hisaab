import { NextResponse, after } from "next/server";
import { messagesIn, requestOk, type Inbound } from "@/channels/whatsapp";
import { handleInbound } from "@/agent/inbound";
import { db } from "@/lib/db";

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

// Chakra calls /api/whatsapp/<WA_WEBHOOK_PATH_SECRET>; it signs only if a secret is set in Chakra.
export async function POST(req: Request, ctx: RouteContext<"/api/whatsapp/[[...k]]">) {
  const { k } = await ctx.params;
  // RAW string: the HMAC is over exactly these bytes.
  const raw = await req.text();
  if (!requestOk(raw, req.headers.get("x-chakra-signature-256"), k?.[0])) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let messages: Inbound[] = [];
  try {
    messages = messagesIn(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  if (!messages.length) return NextResponse.json({ ok: true }); // status receipts

  // Persist before acking. Chakra retries redeliver the same wamid; the skip
  // makes those a no-op, and only rows that were actually new get handled.
  const fresh = await db.waInbox.createManyAndReturn({
    data: messages.map((m) => ({ wamid: m.msg.id, raw: m as object })),
    skipDuplicates: true,
    select: { wamid: true },
  });
  const isNew = new Set(fresh.map((r) => r.wamid));

  after(() =>
    Promise.all(
      messages.filter((m) => isNew.has(m.msg.id)).map(async (m) => {
        try {
          await handleInbound(m);
        } catch (err) {
          console.error("[wa] handle failed", (err as Error)?.message || err);
        }
        await db.waInbox.update({ where: { wamid: m.msg.id }, data: { processed_at: new Date() } });
      }),
    ),
  );

  // Always 200 fast: a slow or non-200 ack makes Chakra retry the whole batch.
  return NextResponse.json({ ok: true });
}
