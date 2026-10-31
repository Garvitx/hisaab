import { connection } from "next/server";
import { db } from "@/lib/db";
import { getScoreboard } from "@/lib/scoreboard";
import { caseRows } from "../cases";

async function load(activeId: string | null) {
  const [scoreboard, merchants, rows, waiting] = await Promise.all([
    getScoreboard(),
    db.merchant.count(),
    caseRows(),
    db.outboxEvent.count({ where: { processed_at: null } }),
  ]);
  const active = rows.find((r) => r.id === activeId) ?? rows[0] ?? null;
  const trace = active
    ? await db.traceEvent.findMany({ where: { case_id: active.id }, orderBy: [{ seq: "asc" }, { created_at: "asc" }] })
    : [];
  const open = (s: string) => s === "AWAITING_APPROVAL" || s === "AWAITING_MERCHANT";
  return {
    scoreboard,
    merchants,
    waiting,
    caseIds: rows.map((r) => r.id),
    newest: rows[0] ?? null,
    queue: {
      pending: rows.filter((r) => open(r.status)),
      escalated: rows.filter((r) => r.status === "ESCALATED"),
      recent: rows.filter((r) => !open(r.status) && r.status !== "ESCALATED").slice(0, 12),
    },
    active,
    trace,
  };
}
export type Overview = Awaited<ReturnType<typeof load>>;

export async function GET(req: Request) {
  await connection();
  return Response.json(await load(new URL(req.url).searchParams.get("case")));
}
