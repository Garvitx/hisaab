// Run: npx tsx src/lib/scoreboard.check.ts
import assert from "node:assert/strict";
import { computeScoreboard } from "./scoreboard";

const t = (s: number) => new Date(Date.UTC(2026, 9, 31, 10, 0, s));
const sb = computeScoreboard(
  [
    { id: "a", merchant_id: "M1", is_decoy: false, created_at: t(0), detected_case_id: "c1", detected_at: t(1) },
    { id: "b", merchant_id: "M2", is_decoy: false, created_at: t(0), detected_case_id: null, detected_at: null }, // caught by later case
    { id: "c", merchant_id: "M3", is_decoy: false, created_at: t(0), detected_case_id: null, detected_at: null }, // missed
    { id: "d", merchant_id: "M4", is_decoy: true, created_at: t(0), detected_case_id: null, detected_at: null }, // flagged
    { id: "e", merchant_id: "M5", is_decoy: true, created_at: t(0), detected_case_id: null, detected_at: null }, // ignored
  ],
  [
    { id: "c1", merchant_id: "M1", opened_at: t(1), detect_ms: 900 },
    { id: "c2", merchant_id: "M2", opened_at: t(3), detect_ms: null },
    { id: "c3", merchant_id: "M4", opened_at: t(30), detect_ms: 500 },
    { id: "c4", merchant_id: "M5", opened_at: new Date(t(0).getTime() + 5 * 60_000), detect_ms: 100 }, // outside 2 min
  ],
  [
    { amount: 594, action_status: "EXECUTED" },
    { amount: 405, action_status: "UNDONE" },
    { amount: 100, action_status: null },
  ],
);
assert.deepEqual(sb, { injected: 3, caught: 2, decoys: 2, decoysIgnored: 1, avgDetectMs: 1950, recovered: 694 });
console.log("scoreboard ok", sb);
