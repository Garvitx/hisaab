import { NextResponse } from "next/server";
import { stt } from "@/channels/voice";
import { addDrafts } from "@/khata/entries";
import { tapSigOk } from "@/khata/tap";

export const maxDuration = 60;

// The tap page's mic (multipart: audio + mid + sig) or its text box (text instead of audio).
// Sarvam STT, then the shared extractor. Everything comes back as drafts for the merchant to confirm.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const mid = form?.get("mid");
  if (typeof mid !== "string" || !tapSigOk(mid, form?.get("sig"))) return NextResponse.json({ error: "Ye sticker valid nahi hai." }, { status: 401 });
  const audio = form!.get("audio");
  let text = typeof form!.get("text") === "string" ? String(form!.get("text")).trim().slice(0, 1000) : "";
  if (audio instanceof Blob && audio.size) {
    if (audio.size > 5_000_000) return NextResponse.json({ error: "Recording bahut lambi hai, chhota bolkar dobara try karein." }, { status: 413 });
    try {
      text = (await stt(Buffer.from(await audio.arrayBuffer()), audio.type || "audio/webm")).text;
    } catch (e) {
      console.error("[khata] stt failed", (e as Error)?.message);
      return NextResponse.json({ error: "Awaaz samajh nahi aayi. Dobara bolein ya likh dijiye." }, { status: 502 });
    }
  }
  if (!text) return NextResponse.json({ error: "Kuch sunai nahi diya. Dobara bolein ya likh dijiye." }, { status: 400 });
  try {
    return NextResponse.json(await addDrafts(mid, text, audio instanceof Blob && audio.size ? "NFC_VOICE" : "DASHBOARD"));
  } catch (e) {
    console.error("[khata] extract failed", (e as Error)?.message);
    return NextResponse.json({ error: "Abhi likh nahi paaye. Thodi der mein dobara try karein.", transcript: text }, { status: 502 });
  }
}
