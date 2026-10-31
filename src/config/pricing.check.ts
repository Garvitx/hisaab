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
assert.ok(llmCostInr("nope", { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }) > 0);
// IST midnight: 18:29:59 UTC is still "today", 18:30 UTC is the next IST day.
assert.equal(istDayStart(Date.parse("2026-10-31T18:29:59Z")).toISOString(), "2026-10-30T18:30:00.000Z");
assert.equal(istDayStart(Date.parse("2026-10-31T18:30:00Z")).toISOString(), "2026-10-31T18:30:00.000Z");
console.log("pricing ok");
