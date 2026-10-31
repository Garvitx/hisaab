// What one AI call costs, in rupees. Used to stamp llm_calls / speech_calls rows at write time.
//
// Sources (checked 31 Oct 2026):
// - Anthropic: https://claude.com/pricing (anthropic.com/pricing redirects there). Cache write = 5-minute TTL tier.
// - Sarvam: https://www.sarvam.ai/api-pricing, pay-as-you-go tier.
// Re-check both before quoting numbers outside the demo; prices change.

// USD per million tokens. Haiku 5.5 is tiered by prompt size: the higher rates apply once the
// prompt (input + cache read + cache write) is over 100K tokens.
type Rates = { input: number; output: number; cache_read: number; cache_write: number };
type Price = Rates & { source: string; over100k?: Rates };

const MODELS: Record<string, Price> = {
  "claude-haiku-5-5": {
    input: 0.1, output: 0.5, cache_write: 0.125, cache_read: 0.01,
    over100k: { input: 0.5, output: 2.5, cache_write: 0.625, cache_read: 0.05 },
    source: "claude.com/pricing",
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_write: 2.5, cache_read: 0.1, source: "claude.com/pricing" },
  "claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2, source: "claude.com/pricing" },
  "claude-fable-5-1": { input: 10, output: 50, cache_write: 12.5, cache_read: 0.25, source: "claude.com/pricing" },
  // Not on today's pricing page; from the Claude API reference model table (cache at the standard 1.25x / 0.1x).
  "claude-sonnet-5": { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2, source: "claude-api model table" },
  "claude-haiku-4-5": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1, source: "claude-api model table" },
};
// Any other model id (MODEL_CONVERSE/HUNT/NOTIFY can be swapped on the day) still records its tokens;
// the cost uses this deliberately pessimistic tier until the id is added above.
const FALLBACK: Price = { input: 10, output: 50, cache_write: 12.5, cache_read: 0.25, source: "FALLBACK: unknown model, priced at the most expensive tier" };

// "claude-haiku-4-5-20251001" -> its family entry. Longest key wins so sonnet-5-5 never matches sonnet-5.
export function modelPrice(model: string) {
  const id = model.replace(/\[.*\]$/, "");
  const key = Object.keys(MODELS).filter((k) => id === k || id.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  return key ? { ...MODELS[key], model: key } : { ...FALLBACK, model: id };
}

// ponytail: fixed rate for the demo; set USD_INR on Vercel to the day's RBI reference rate if it matters.
export const usdInr = () => Number(process.env.USD_INR) || 84;

export type Usage = { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };

export function llmCostInr(model: string, u: Usage) {
  const p = modelPrice(model);
  const prompt = u.input_tokens + u.cache_read_tokens + u.cache_write_tokens;
  const r: Rates = p.over100k && prompt > 100_000 ? p.over100k : p;
  const usd = (u.input_tokens * r.input + u.output_tokens * r.output + u.cache_read_tokens * r.cache_read + u.cache_write_tokens * r.cache_write) / 1e6;
  return usd * usdInr();
}

// Sarvam, in rupees, pay-as-you-go (sarvam.ai/api-pricing).
export const SARVAM = {
  stt_per_minute: 0.49, // speech-to-text (saaras), per minute of audio
  tts_per_1k_chars: { "bulbul:v3": 3.0, "bulbul:v4-flash": 1.0 } as Record<string, number>, // per 1,000 characters
};
export const TTS_MODEL = "bulbul:v3";

export const sttCostInr = (seconds: number) => (seconds / 60) * SARVAM.stt_per_minute;
export const ttsCostInr = (characters: number, model = TTS_MODEL) =>
  (characters / 1_000) * (SARVAM.tts_per_1k_chars[model] ?? SARVAM.tts_per_1k_chars[TTS_MODEL]);
