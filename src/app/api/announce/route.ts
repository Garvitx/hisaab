import type { NextRequest } from "next/server";
import { ttsMp3 } from "@/channels/voice";

// ponytail: per-instance Map, cleared at 200 entries; the Soundbox repeats a handful of phrases.
const cache = new Map<string, Buffer>();

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get("text") ?? "").trim();
  if (!text || text.length > 200) return Response.json({ error: "text must be 1-200 chars" }, { status: 400 });
  let mp3 = cache.get(text);
  if (!mp3) {
    try {
      mp3 = await ttsMp3(text, "hi");
    } catch (err) {
      console.error("[announce] tts failed", (err as Error)?.message || err);
      return Response.json({ error: "tts failed" }, { status: 502 });
    }
    if (cache.size >= 200) cache.clear();
    cache.set(text, mp3);
  }
  return new Response(new Uint8Array(mp3), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
  });
}
