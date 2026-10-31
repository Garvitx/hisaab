// Run: npx tsx src/config/pricing.check.ts (offline)
import assert from "node:assert/strict";
import { llmCostInr, modelPrice, usdInr } from "./pricing";
import { istDayStart } from "../lib/cost";

// Longest family wins; dated ids resolve to their family; unknown ids fall back, never throw.
assert.equal(modelPrice("claude-sonnet-5-5").model, "claude-sonnet-5-5");
assert.equal(modelPrice("claude-sonnet-5").input, 2);
assert.equal(modelPrice("claude-haiku-4-5-20251001").model, "claude-haiku-4-5");
assert.ok(modelPrice("gpt-9").source.startsWith("FALLBACK"));
const c = llmCostInr("claude-sonnet-5", { input_tokens: 1e6, output_tokens: 1e6, cache_read_tokens: 1e6, cache_write_tokens: 1e6 });
assert.ok(Math.abs(c - (2 + 10 + 0.2 + 2.5) * usdInr()) < 1e-9, `sonnet-5 cost ${c}`);
// Haiku 5.5 is tiered: small prompts at $0.10/$0.50, prompts over 100K tokens at $0.50/$2.50.
const small = llmCostInr("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0 });
assert.ok(Math.abs(small - ((1000 * 0.1 + 1000 * 0.5) / 1e6) * usdInr()) < 1e-12, `haiku small ${small}`);
const big = llmCostInr("claude-haiku-5-5", { input_tokens: 150_000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0 });
assert.ok(Math.abs(big - ((150_000 * 0.5 + 1000 * 2.5) / 1e6) * usdInr()) < 1e-12, `haiku big ${big}`);
assert.equal(modelPrice("claude-sonnet-5-5").input, 2);
assert.ok(llmCostInr("nope", { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }) > 0);
// IST midnight: 18:29:59 UTC is still "today", 18:30 UTC is the next IST day.
assert.equal(istDayStart(Date.parse("2026-10-31T18:29:59Z")).toISOString(), "2026-10-30T18:30:00.000Z");
assert.equal(istDayStart(Date.parse("2026-10-31T18:30:00Z")).toISOString(), "2026-10-31T18:30:00.000Z");
console.log("pricing ok");
