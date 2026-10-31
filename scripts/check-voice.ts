// Run: npx tsx scripts/check-voice.ts. Hits Sarvam and Chakra's upload endpoint; never sends a message.
import { config } from "dotenv";
import assert from "node:assert/strict";
config({ path: ".env.local", quiet: true }); // env is read lazily, so hoisted imports below are fine

import { tts, stt } from "../src/channels/voice.ts";
import { uploadPublicMedia, parseInbound, type WaMsg } from "../src/channels/whatsapp.ts";

const base = { id: "w1", from: "919800000000" };
const cases: [WaMsg, ReturnType<typeof parseInbound>][] = [
  [{ ...base, type: "text", text: { body: "refund kab aayega?" } }, { kind: "text", text: "refund kab aayega?" }],
  [{ ...base, type: "audio", audio: { id: "A1", mime_type: "audio/ogg; codecs=opus", voice: true } }, { kind: "voice", mediaId: "A1" }],
  [{ ...base, type: "image", image: { id: "I1", mime_type: "image/jpeg", caption: "bill" } }, { kind: "image", mediaId: "I1", caption: "bill" }],
  [{ ...base, type: "image", image: { id: "I2" } }, { kind: "image", mediaId: "I2", caption: "" }],
  [{ ...base, type: "interactive", interactive: { type: "button_reply", button_reply: { id: "approve:C42", title: "Approve" } } }, { kind: "button", id: "approve:C42", title: "Approve" }],
  [{ ...base, type: "button", button: { payload: "Reject", text: "Reject" } }, { kind: "button", id: "Reject", title: "Reject" }],
  [{ ...base, type: "sticker" }, { kind: "other", type: "sticker" }],
];
for (const [msg, want] of cases) assert.deepEqual(parseInbound(msg), want);
console.log("parseInbound ok");

async function main() {
  const sentence = "Aapke account mein 594 rupaye ka refund aa gaya hai";
  const ogg = await tts(sentence, "hinglish");
  assert.equal(ogg.subarray(0, 4).toString(), "OggS", "OggS magic");
  assert.ok(ogg.includes(Buffer.from("OpusHead")), "OpusHead");
  // Last Ogg page's granule position / 48 kHz = duration.
  const last = ogg.lastIndexOf(Buffer.from("OggS"));
  const secs = Number(ogg.readBigUInt64LE(last + 6)) / 48_000;
  assert.ok(secs > 1, `duration ${secs}s`);
  console.log(`tts ok: ${ogg.length} bytes, ${secs.toFixed(2)}s`);

  const { text, language } = await stt(ogg, "audio/ogg; codecs=opus");
  console.log(`stt [${language}]: ${text}`);
  assert.ok(/594|refund|रिफंड|पाँच सौ|५९४/i.test(text), "transcript mentions 594 or refund");

  const link = await uploadPublicMedia(ogg, "audio/ogg", "check-voice.ogg");
  console.log("upload ok:", link);
  assert.ok(new URL(link).pathname.endsWith(".ogg"), "link ends in .ogg");
  console.log("voice ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
