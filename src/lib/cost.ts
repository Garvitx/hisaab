import { db } from "@/lib/db";

// cases.ai_cost_inr is a cached sum of the case's llm_calls + speech_calls. Recomputed (not
// incremented) on every write so a retried or concurrent write can never double-count.
export async function refreshCaseCost(case_id: string) {
  const [l, s] = await Promise.all([
    db.llmCall.aggregate({ where: { case_id }, _sum: { cost_inr: true } }),
    db.speechCall.aggregate({ where: { case_id }, _sum: { cost_inr: true } }),
  ]);
  await db.case.updateMany({ where: { id: case_id }, data: { ai_cost_inr: (l._sum.cost_inr ?? 0) + (s._sum.cost_inr ?? 0) } });
}

// Case page breakdown: one row per role + model (LLM) and per kind (speech).
export async function caseCost(case_id: string) {
  const [llm, speech] = await Promise.all([
    db.llmCall.groupBy({
      by: ["role", "model"],
      where: { case_id },
      _count: true,
      _sum: { input_tokens: true, output_tokens: true, cache_read_tokens: true, cache_write_tokens: true, cost_inr: true, ms: true },
    }),
    db.speechCall.groupBy({ by: ["kind"], where: { case_id }, _count: true, _sum: { seconds: true, characters: true, cost_inr: true } }),
  ]);
  return {
    llm: llm.map((r) => ({
      role: r.role, model: r.model, calls: r._count,
      input_tokens: r._sum.input_tokens ?? 0, output_tokens: r._sum.output_tokens ?? 0,
      cache_read_tokens: r._sum.cache_read_tokens ?? 0, cache_write_tokens: r._sum.cache_write_tokens ?? 0,
      ms: r._sum.ms ?? 0, cost_inr: r._sum.cost_inr ?? 0,
    })),
    speech: speech.map((r) => ({ kind: r.kind, calls: r._count, seconds: r._sum.seconds ?? 0, characters: r._sum.characters ?? 0, cost_inr: r._sum.cost_inr ?? 0 })),
  };
}

// Midnight IST as a UTC instant (IST is a fixed +05:30, no DST).
export function istDayStart(now = Date.now()) {
  const IST = 330 * 60_000;
  return new Date(Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST);
}

// Scoreboard: averages over cases that have the number (older cases predate tracking), spend over today's calls.
export async function aiStats() {
  const since = istDayStart();
  const [cases, l, s] = await Promise.all([
    db.case.aggregate({ _avg: { resolution_ms: true, ai_cost_inr: true } }),
    db.llmCall.aggregate({ where: { created_at: { gte: since } }, _sum: { cost_inr: true } }),
    db.speechCall.aggregate({ where: { created_at: { gte: since } }, _sum: { cost_inr: true } }),
  ]);
  return {
    avgResolutionMs: cases._avg.resolution_ms == null ? null : Math.round(cases._avg.resolution_ms),
    avgCostInr: cases._avg.ai_cost_inr,
    spendTodayInr: (l._sum.cost_inr ?? 0) + (s._sum.cost_inr ?? 0),
  };
}
export type AiStats = Awaited<ReturnType<typeof aiStats>>;
