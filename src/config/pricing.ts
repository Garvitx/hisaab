// What one AI call costs, in rupees. Used to stamp llm_calls / speech_calls rows at write time.
//
// TODO: verify every Anthropic price against https://www.anthropic.com/pricing (or the API docs
// pricing page) and every Sarvam price against https://www.sarvam.ai/api-pricing before quoting
// these numbers anywhere. Each entry says where it came from.

// USD per million tokens. Cache read is 0.1x input and a 5-minute cache write is 1.25x input on
// Anthropic's published tiers; the same multipliers are assumed for every model below.
const tier = (input: number, output: number, source: string) => ({ input, output, cache_read: input * 0.1, cache_write: input * 1.25, source });

const MODELS: Record<string, ReturnType<typeof tier>> = {
  "claude-sonnet-5": tier(2, 10, "claude-api skill model table"),
  "claude-haiku-4-5": tier(1, 5, "claude-api skill model table"),
  // ASSUMPTION, placeholder, verify: not in the model table. Priced like Haiku 4.5.
  "claude-haiku-5-5": tier(1, 5, "assumption: same as haiku-4-5"),
  // ASSUMPTION, placeholder, verify: not in the model table. Priced at the older Sonnet $3/$15, so it errs high.
  "claude-sonnet-5-5": tier(3, 15, "assumption: older Sonnet tier"),
};
// Any other model id (MODEL_CONVERSE/HUNT/NOTIFY can be swapped on the day) still records its tokens;
// the cost uses this deliberately pessimistic Opus-class tier until the id is added above.
const FALLBACK = tier(5, 25, "FALLBACK: unknown model, placeholder");

// "claude-haiku-4-5-20251001" -> its family entry. Longest key wins so sonnet-5-5 never matches sonnet-5.
export function modelPrice(model: string) {
  const id = model.replace(/\[.*\]$/, "");
  const key = Object.keys(MODELS).filter((k) => id === k || id.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  return key ? { ...MODELS[key], model: key } : { ...FALLBACK, model: id };
}

// Placeholder, verify: RBI reference rate moves daily; 84 was roughly right when this was written.
export const usdInr = () => Number(process.env.USD_INR) || 84;

export type Usage = { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };

export function llmCostInr(model: string, u: Usage) {
  const p = modelPrice(model);
  const usd = (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_tokens * p.cache_read + u.cache_write_tokens * p.cache_write) / 1e6;
  return usd * usdInr();
}

// Sarvam, in rupees. Placeholder, verify both against sarvam.ai pricing.
export const SARVAM = {
  stt_per_hour: 30, // saaras:v4 speech-to-text, placeholder, verify
  tts_per_10k_chars: { "bulbul:v3": 30 } as Record<string, number>, // placeholder, verify
};
export const TTS_MODEL = "bulbul:v3";

export const sttCostInr = (seconds: number) => (seconds / 3600) * SARVAM.stt_per_hour;
export const ttsCostInr = (characters: number, model = TTS_MODEL) => (characters / 10_000) * (SARVAM.tts_per_10k_chars[model] ?? SARVAM.tts_per_10k_chars[TTS_MODEL]);
