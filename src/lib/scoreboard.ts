import { db } from "@/lib/db";

// Scoreboard only (UI code, not agent code): reading hisaab.injections here is allowed, CLAUDE.md rule 3.

type Inj = { id: string; merchant_id: string; is_decoy: boolean; created_at: Date; detected_case_id: string | null; detected_at: Date | null };
type Cs = { id: string; merchant_id: string; opened_at: Date; detect_ms: number | null };
type Cr = { amount: number; action_status: string | null };

export type Scoreboard = {
  injected: number;
  caught: number;
  decoys: number;
  decoysIgnored: number;
  avgDetectMs: number | null;
  recovered: number;
};

const DECOY_WINDOW_MS = 2 * 60 * 1000;

export function computeScoreboard(injections: Inj[], cases: Cs[], credits: Cr[]): Scoreboard {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const byMerchant = new Map<string, Cs[]>();
  for (const c of cases) byMerchant.set(c.merchant_id, [...(byMerchant.get(c.merchant_id) ?? []), c]);

  let caught = 0;
  const detect: number[] = [];
  let decoys = 0;
  let decoysIgnored = 0;

  for (const i of injections) {
    const t = i.created_at.getTime();
    const later = (byMerchant.get(i.merchant_id) ?? []).filter((c) => c.opened_at.getTime() >= t);
    if (i.is_decoy) {
      decoys++;
      if (!later.some((c) => c.opened_at.getTime() - t <= DECOY_WINDOW_MS)) decoysIgnored++;
      continue;
    }
    const hit =
      (i.detected_case_id && byId.get(i.detected_case_id)) ||
      later.sort((a, b) => a.opened_at.getTime() - b.opened_at.getTime())[0];
    if (!i.detected_case_id && !hit) continue;
    caught++;
    const ms = hit
      ? (hit.detect_ms ?? hit.opened_at.getTime() - t)
      : i.detected_at
        ? i.detected_at.getTime() - t
        : null;
    if (ms != null && ms >= 0) detect.push(ms);
  }

  return {
    injected: injections.filter((i) => !i.is_decoy).length,
    caught,
    decoys,
    decoysIgnored,
    avgDetectMs: detect.length ? Math.round(detect.reduce((a, b) => a + b, 0) / detect.length) : null,
    recovered: credits.filter((c) => c.action_status !== "UNDONE").reduce((a, c) => a + c.amount, 0),
  };
}

export async function getScoreboard(): Promise<Scoreboard> {
  const [injections, cases, credits, undone] = await Promise.all([
    db.injection.findMany({
      select: { id: true, merchant_id: true, is_decoy: true, created_at: true, detected_case_id: true, detected_at: true },
    }),
    db.case.findMany({ select: { id: true, merchant_id: true, opened_at: true, detect_ms: true } }),
    db.credit.findMany({ select: { amount: true, action_id: true } }),
    db.action.findMany({ where: { status: "UNDONE" }, select: { id: true } }),
  ]);
  const u = new Set(undone.map((a) => a.id));
  return computeScoreboard(
    injections,
    cases,
    credits.map((c) => ({ amount: c.amount, action_status: c.action_id && u.has(c.action_id) ? "UNDONE" : null })),
  );
}
