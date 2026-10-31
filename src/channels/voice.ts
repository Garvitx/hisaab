// Speech in and out. Sarvam handles Hindi, Hinglish and English; it cannot emit
// Opus, so WhatsApp voice notes are Sarvam audio transcoded by ffmpeg-static.

import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { speakable } from "./numbers.ts";
import { sttCostInr, ttsCostInr, TTS_MODEL } from "@/config/pricing";

export type Lang = "hi" | "hinglish" | "en";

// Which case / chat a speech call belongs to, for cost tracking.
export type SpeechMeta = { case_id?: string | null; conversation_id?: string | null };

// One speech_calls row per Sarvam call. A failed write is logged, never fails the speech itself.
export async function recordSpeechCall(kind: "STT" | "TTS", amount: { seconds?: number; characters?: number }, meta: SpeechMeta = {}): Promise<void> {
  try {
    const { db } = await import("@/lib/db"); // lazy: check-voice loads this file before dotenv
    const cost_inr = kind === "STT" ? sttCostInr(amount.seconds ?? 0) : ttsCostInr(amount.characters ?? 0, TTS_MODEL);
    await db.speechCall.create({ data: { kind, seconds: amount.seconds ?? null, characters: amount.characters ?? null, cost_inr, case_id: meta.case_id ?? null, conversation_id: meta.conversation_id ?? null } });
    if (meta.case_id) await (await import("@/lib/cost")).refreshCaseCost(meta.case_id);
  } catch (e) {
    console.error("[voice] record failed", (e as Error)?.message);
  }
}

// Audio length in seconds, from ffmpeg decoding to nowhere (works for every format WhatsApp sends).
// ponytail: one extra ffmpeg run per voice note (~50 ms for 30 s of Opus), runs alongside Sarvam.
export function audioSeconds(buf: Buffer): Promise<number> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(0);
    const p = spawn(ffmpegPath, ["-hide_banner", "-i", "pipe:0", "-f", "null", "-"]);
    const err: Buffer[] = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT);
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", () => (clearTimeout(timer), resolve(0)));
    p.on("close", () => {
      clearTimeout(timer);
      // The last "time=HH:MM:SS.ss" progress line is how much audio was decoded.
      const t = [...Buffer.concat(err).toString().matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
      resolve(t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0);
    });
    p.stdin.on("error", () => {});
    p.stdin.end(buf);
  });
}

const SARVAM = "https://api.sarvam.ai";
const TIMEOUT = 20_000;

function key(kind: "STT" | "TTS") {
  const provider = process.env[`${kind}_PROVIDER`];
  if (provider !== "sarvam") throw new Error(`${kind}_PROVIDER "${provider ?? ""}" not supported (only "sarvam")`);
  const k = process.env[`${kind}_API_KEY`];
  if (!k) throw new Error(`${kind}_API_KEY missing`);
  return k;
}

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/opus": "opus", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav", "audio/webm": "webm" };

// saaras:v4 takes OGG/Opus directly. mode "translit" keeps what was said, romanised: without a
// mode it TRANSLATES Hinglish to English ("mera soundbox kharab hai" came back "My sound box is bad").
export async function stt(audio: Buffer, mime: string, meta?: SpeechMeta): Promise<{ text: string; language?: string }> {
  const seconds = audioSeconds(audio);
  const type = mime.split(";")[0].trim().toLowerCase() || "audio/ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `voice.${EXT[type] ?? "ogg"}`);
  form.append("model", "saaras:v4");
  form.append("mode", "translit");
  form.append("language_code", "unknown");
  const res = await fetch(`${SARVAM}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": key("STT") },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`sarvam stt ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = await res.json();
  await recordSpeechCall("STT", { seconds: Math.round((await seconds) * 100) / 100 }, meta);
  return { text: String(json?.transcript ?? "").trim(), language: json?.language_code ?? undefined };
}

// MP3 for both outputs: if Sarvam splits text into several clips, MP3 frames concatenate
// cleanly where WAV headers would not. ffmpeg then re-encodes to Opus for WhatsApp.
export async function ttsMp3(text: string, lang: Lang, meta?: SpeechMeta): Promise<Buffer> {
  const said = speakable(text, lang).slice(0, 2500);
  const res = await fetch(`${SARVAM}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key("TTS"), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: said,
      language_code: lang === "en" ? "en-IN" : "hi-IN",
      model: TTS_MODEL,
      // Sarvam's default bulbul:v3 voice is the one the user picked; TTS_SPEAKER overrides it.
      ...(process.env.TTS_SPEAKER ? { speaker: process.env.TTS_SPEAKER } : {}),
      output_audio_codec: "mp3",
      speech_sample_rate: 24000,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`sarvam tts ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const audios: string[] = (await res.json())?.audios ?? [];
  if (!audios.length) throw new Error("sarvam tts returned no audio");
  await recordSpeechCall("TTS", { characters: said.length }, meta);
  return Buffer.concat(audios.map((a) => Buffer.from(a, "base64")));
}

export const tts = async (text: string, lang: Lang, meta?: SpeechMeta) => toOpus(await ttsMp3(text, lang, meta));

// These exact flags were verified to render as a voice note in WhatsApp.
export function toOpus(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static has no binary for this platform"));
    const p = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000", "-application", "voip", "-f", "ogg", "pipe:1"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => (clearTimeout(timer), reject(e)));
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`));
    });
    p.stdin.on("error", () => {}); // EPIPE if ffmpeg dies early; close handler reports it
    p.stdin.end(buf);
  });
}
