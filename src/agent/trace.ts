import { db } from "@/lib/db";
import type { TraceKind } from "@/generated/prisma/client";

// Every agent and engine step lands here (CLAUDE.md rule 4); the dashboard polls it.
// ponytail: seq is max+1 per case/conversation, so two concurrent writers can tie.
// created_at breaks the tie for ordering; switch to a Postgres sequence if that ever matters.
export async function trace(e: {
  kind: TraceKind;
  name: string;
  case_id?: string | null;
  conversation_id?: string | null;
  payload?: unknown;
  ms?: number;
}) {
  const where = e.case_id ? { case_id: e.case_id } : e.conversation_id ? { conversation_id: e.conversation_id } : null;
  const last = where
    ? await db.traceEvent.findFirst({ where, orderBy: { seq: "desc" }, select: { seq: true } })
    : null;
  return db.traceEvent.create({
    data: {
      kind: e.kind,
      name: e.name,
      case_id: e.case_id ?? null,
      conversation_id: e.conversation_id ?? null,
      payload: (e.payload ?? undefined) as object | undefined,
      ms: e.ms ?? null,
      seq: (last?.seq ?? 0) + 1,
    },
  });
}

// Wraps a step so its duration is recorded with it.
export async function timed<T>(fn: () => Promise<T>) {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}
