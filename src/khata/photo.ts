// A photo of a khata page / bill ("Add as income"): read it as plain text first, then the normal
// extractor turns that text into DRAFTS. The model only transcribes what's written; code still
// reads every amount from the transcribed lines, and the merchant confirms each draft.
import type Anthropic from "@anthropic-ai/sdk";
import { MODEL, create, textOf } from "@/agent/llm";

const SYSTEM = `You transcribe a photo of an Indian shopkeeper's handwritten or printed account page (khata), bill or list.
Write every entry line exactly as written, one per line: name, amount, item or note, in the order on the page (e.g. "Rakesh ji - 200 - Shampoo").
Keep numbers exactly as written. Don't add, total, translate or guess anything; mark an unreadable word as [?]. If there are no entries, reply with nothing.`;

export async function readKhataPhoto(url: string, conversation_id?: string | null) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`photo fetch failed (${res.status})`);
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0] as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const out = await create(
    {
      model: MODEL.converse(),
      max_tokens: 2048,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data } } as Anthropic.ImageBlockParam, { type: "text", text: "Transcribe the entries." }] }],
    },
    { role: "KHATA", conversation_id },
  );
  return textOf(out).trim();
}
