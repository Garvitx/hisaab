// ChakraHQ transport. Chakra's webhook body is Meta's byte for byte and its send
// endpoint takes Meta's message shapes; only the URLs and the bearer differ.
// Ported from webight-ops/src/lib/whatsapp-intake.js, which runs on this number today.

import { createHmac, timingSafeEqual } from "node:crypto";
import { tts, type Lang } from "./voice.ts";

const ver = () => process.env.WHATSAPP_API_VERSION || "v22.0";
const TIMEOUT = 8_000;

export type WaMsg = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { payload: string; text: string }; // template quick-reply
  [k: string]: unknown;
};

export type Parsed =
  | { kind: "text"; text: string }
  | { kind: "voice"; mediaId: string }
  | { kind: "image"; mediaId: string; caption: string }
  | { kind: "button"; id: string; title: string }
  | { kind: "other"; type: string };

export function parseInbound(msg: WaMsg): Parsed {
  if (msg.type === "text" && msg.text) return { kind: "text", text: msg.text.body ?? "" };
  if (msg.type === "audio" && msg.audio?.id) return { kind: "voice", mediaId: msg.audio.id };
  if (msg.type === "image" && msg.image?.id) return { kind: "image", mediaId: msg.image.id, caption: msg.image.caption ?? "" };
  const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
  if (msg.type === "interactive" && r) return { kind: "button", id: r.id, title: r.title };
  // Template quick replies carry no id; the payload is what we set when sending (or the label).
  if (msg.type === "button" && msg.button) return { kind: "button", id: msg.button.payload || msg.button.text, title: msg.button.text };
  return { kind: "other", type: msg.type };
}
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

const chakra = () => {
  const token = process.env.CHAKRA_API_KEY;
  const pluginId = process.env.CHAKRA_PLUGIN_ID;
  if (!token || !pluginId) throw new Error("chakra env missing");
  return { token, pluginId };
};

const MEDIA_TIMEOUT = 20_000;

async function bytes(res: Response) {
  if (!res.ok) throw new Error(`media fetch failed (${res.status})`);
  return { buf: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") || "application/octet-stream" };
}

// /show answers with a redirect to a signed CDN URL (or the bytes). The CDN rejects
// our bearer, so the Location is fetched bare. /media/{id} is the JSON fallback.
export async function fetchMedia(mediaId: string): Promise<{ buf: Buffer; mime: string }> {
  const { token } = chakra();
  const auth = { Authorization: `Bearer ${token}` };
  const id = encodeURIComponent(mediaId);
  try {
    const res = await fetch(`https://api.chakrahq.com/v2/whatsapp/${ver()}/media/${id}/show`, {
      headers: auth,
      redirect: "manual",
      signal: AbortSignal.timeout(MEDIA_TIMEOUT),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) return await bytes(await fetch(loc, { signal: AbortSignal.timeout(MEDIA_TIMEOUT) }));
    if (res.ok) return await bytes(res);
    console.error("[wa] media show failed", res.status);
  } catch (err) {
    console.error("[wa] media show threw", (err as Error)?.message || err);
  }
  const meta = await fetch(`https://api.chakrahq.com/v1/whatsapp/${ver()}/media/${id}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT) });
  if (!meta.ok) throw new Error(`media lookup failed (${meta.status})`);
  const { url, mime_type } = await meta.json();
  if (!url) throw new Error("media lookup returned no url");
  const got = await bytes(await fetch(url, { signal: AbortSignal.timeout(MEDIA_TIMEOUT) }));
  return { buf: got.buf, mime: mime_type || got.mime };
}

export async function uploadPublicMedia(buf: Buffer, mime: string, filename: string): Promise<string> {
  const { token, pluginId } = chakra();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  const res = await fetch(`https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/upload-public-media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(MEDIA_TIMEOUT),
  });
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const link = (await res.json())?._data?.publicMediaUrl;
  if (!link) throw new Error("upload returned no publicMediaUrl");
  return link as string;
}

export const sendAudio = (to: string, link: string) => send({ to: digits(to), type: "audio", audio: { link } });

export const sendDocument = (to: string, link: string, filename: string, caption?: string) =>
  send({ to: digits(to), type: "document", document: { link, filename, ...(caption ? { caption } : {}) } });

// Meta caps reply buttons at 3, titles at 20 chars, ids at 256 and the body at 1024.
export function sendButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
  return send({
    to: digits(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })),
      },
    },
  });
}

// Template params can't carry newlines, tabs or 4+ spaces (Meta rejects them), and stay short.
const tparam = (t: string, max = 300) => t.replace(/\s+/g, " ").trim().slice(0, max) || "-";

// params: an object for templates with NAMED variables ({{name}}, Chakra's format), or a list for
// positional ones ({{1}}). quickReplies: payloads for the quick-reply buttons, in order; they come
// back as msg.button.payload, which parseInbound turns into a button id.
export function sendTemplate(to: string, name: string, langCode: string, params: Record<string, string> | string[], quickReplies: string[] = []) {
  const components: unknown[] = [];
  const body = Array.isArray(params)
    ? params.map((t) => ({ type: "text", text: tparam(t) }))
    : Object.entries(params).map(([parameter_name, t]) => ({ type: "text", parameter_name, text: tparam(t) }));
  if (body.length) components.push({ type: "body", parameters: body });
  quickReplies.forEach((payload, i) => components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] }));
  return send({ to: digits(to), type: "template", template: { name, language: { code: langCode }, ...(components.length ? { components } : {}) } });
}

export async function sendVoice(to: string, text: string, lang: Lang) {
  try {
    const link = await uploadPublicMedia(await tts(text, lang), "audio/ogg", `voice-${Date.now()}.ogg`);
    return { ...(await sendAudio(to, link)), link };
  } catch (err) {
    console.error("[wa] voice failed", (err as Error)?.message || err);
    return { ok: false, error: "voice failed", link: undefined };
  }
}
