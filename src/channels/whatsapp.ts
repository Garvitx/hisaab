// ChakraHQ transport. Chakra's webhook body is Meta's byte for byte and its send
// endpoint takes Meta's message shapes; only the URLs and the bearer differ.
// Ported from webight-ops/src/lib/whatsapp-intake.js, which runs on this number today.

import { createHmac, timingSafeEqual } from "node:crypto";

const ver = () => process.env.WHATSAPP_API_VERSION || "v22.0";
const TIMEOUT = 8_000;

export type WaMsg = { id: string; from: string; type: string; [k: string]: unknown };
export type Inbound = { msg: WaMsg; phoneNumberId: string | null; contactName: string | null };

// Chakra sends a bare hex digest, Meta sends "sha256=<hex>". Accept either.
// Fails closed: an unset secret must never mean "let everyone in".
export function signatureOk(raw: string, header: string | null, secret = process.env.CHAKRA_WEBHOOK_SECRET) {
  if (!secret || !header) return false;
  const got = Buffer.from(header.replace(/^sha256=/i, ""), "hex");
  const want = createHmac("sha256", secret).update(raw).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

// Chakra signs only when a secret is set in its dashboard; webight runs unsigned
// behind an unguessable path. Each guard that is configured must pass, and at
// least one must be configured.
export function requestOk(
  raw: string,
  header: string | null,
  pathSecret: string | undefined,
  env: { hmac?: string; path?: string } = { hmac: process.env.CHAKRA_WEBHOOK_SECRET, path: process.env.WA_WEBHOOK_PATH_SECRET },
) {
  if (!env.hmac && !env.path) return false;
  if (env.hmac && !signatureOk(raw, header, env.hmac)) return false;
  if (env.path && !sameSecret(pathSecret, env.path)) return false;
  return true;
}

const sameSecret = (a: string | undefined, b: string) =>
  !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// All three levels are arrays and Meta batches them. Status receipts carry only
// value.statuses and flatten to nothing.
export function messagesIn(body: any): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      const contacts = value?.contacts || [];
      for (const msg of value?.messages || []) {
        const contact = contacts.find((c: any) => c?.wa_id === msg?.from) || contacts[0];
        out.push({
          msg,
          phoneNumberId: value?.metadata?.phone_number_id || null,
          contactName: contact?.profile?.name || null,
        });
      }
    }
  }
  return out;
}

export const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
export const samePhone = (a: string | null | undefined, b: string | null | undefined) =>
  !!digits(a) && digits(a) === digits(b);

async function send(payload: Record<string, unknown>) {
  const token = process.env.CHAKRA_API_KEY;
  const pluginId = process.env.CHAKRA_PLUGIN_ID;
  const phoneNumberId = process.env.CHAKRA_PHONE_NUMBER_ID;
  if (!token || !pluginId || !phoneNumberId) return { ok: false, error: "chakra env missing" };

  const url = `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/api/${ver()}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      console.error("[wa] send failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return { ok: false, error: `send failed (${res.status})` };
    }
    const json = await res.json().catch(() => ({}));
    // Chakra wraps the id as _data.whatsappMessageId; Meta's shape kept as a fallback.
    return { ok: true, wamid: (json?._data?.whatsappMessageId ?? json?.messages?.[0]?.id) as string | undefined };
  } catch (err) {
    console.error("[wa] send threw", (err as Error)?.message || err);
    return { ok: false, error: "send failed" };
  }
}

export function sendText(to: string, body: string) {
  return send({
    to: digits(to),
    type: "text",
    text: { body: body.length > 4096 ? `${body.slice(0, 4093)}...` : body },
  });
}
