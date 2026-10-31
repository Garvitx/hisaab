// Outbox drain behind /api/watch. Lives here so scripts/check-inject.ts can run it without HTTP.
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { detectMerchant } from "@/engine/detect";
import { hunt } from "@/agent/hunter";
import { notifyCase } from "@/agent/outreach";

type Ev = { id: bigint; schema: string; table: string; row_id: string; op: string; merchant_id: string | null; created_at: Date };

const secretOk = (got: string, want = process.env.WATCH_SECRET) =>
  !!want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));

// Returns null when a secret header is present but wrong.
export async function drain(secret: string | null = null) {
  if (secret !== null && !secretOk(secret)) return null;
  const t0 = Date.now();
  // One statement = one transaction. Only merchants whose newest event is 1.5 s old are taken,
  // so a multi-table injection lands whole; SKIP LOCKED lets concurrent heartbeats split the work.
  // Events we never act on (merchant master, no merchant) are drained along the way.
  const rows = await db.$queryRaw<Ev[]>`
    WITH ready AS (
      SELECT merchant_id FROM hisaab.outbox_events
      WHERE processed_at IS NULL AND merchant_id IS NOT NULL AND "schema" <> 'hisaab'
        AND NOT ("schema" = 'merchants' AND "table" = 'merchants')
      GROUP BY merchant_id
      -- A customer payment lands whole in one insert, so it needs no settle time; debouncing on it
      -- would starve a busy shop (a queue of payers keeps it from ever going quiet for 1.5 s).
      HAVING coalesce(max(created_at) FILTER (WHERE NOT ("schema" = 'settlement' AND "table" = 'payments' AND op = 'INSERT')), '-infinity')
             <= now() - interval '1.5 seconds'
    ), taken AS (
      SELECT id FROM hisaab.outbox_events
      WHERE processed_at IS NULL
        AND (merchant_id IN (SELECT merchant_id FROM ready) OR merchant_id IS NULL
             OR "schema" = 'hisaab' OR ("schema" = 'merchants' AND "table" = 'merchants'))
      FOR UPDATE SKIP LOCKED
    )
    UPDATE hisaab.outbox_events o SET processed_at = now()
    FROM taken WHERE o.id = taken.id
    RETURNING o.id, o."schema", o."table", o.row_id, o.op, o.merchant_id, o.created_at`;

  const byMerchant = new Map<string, Ev[]>();
  for (const e of rows) {
    if (!e.merchant_id || e.schema === "hisaab" || (e.schema === "merchants" && e.table === "merchants")) continue;
    byMerchant.set(e.merchant_id, [...(byMerchant.get(e.merchant_id) ?? []), e]);
  }

  // Concurrent per merchant: the hunter makes detection slow, but the response waits for all.
  const merchants = await Promise.all(
    [...byMerchant].map(async ([merchant_id, evs]) => {
      evs.sort((a, b) => Number(a.id - b.id));
      try {
        // Plain customer payments skip the LLM hunter (no cost per sale) but still get the cheap rules,
        // which is where the card-testing burst shows up.
        const plain = await onlyPlainPayments(evs);
        const r = await detectMerchant(merchant_id, {
          firstEventAt: evs.reduce((m, e) => (e.created_at < m ? e.created_at : m), evs[0].created_at),
          events: evs.map(({ schema, table, row_id, op }) => ({ schema, table, row_id, op })),
          hunt: plain ? undefined : hunt,
        });
        if (r.case_id) {
          await stampInjection(merchant_id, r.case_id);
          // A failed message must not undo a detection; the case is already on the dashboard.
          await notifyCase(r.case_id).catch((e) => console.error("[watch] notify failed", r.case_id, (e as Error)?.message || e));
        }
        return { merchant_id, ...r };
      } catch (err) {
        // ponytail: events stay processed, so a failed detection is not retried; re-inject to retry.
        console.error("[watch] detect failed", merchant_id, (err as Error)?.message || err);
        return { merchant_id, case_id: null, findings: 0, error: (err as Error)?.message || String(err) };
      }
    }),
  );
  return { drained: rows.length, merchants, ms: Date.now() - t0 };
}

// A customer paying (the audience pay page, normal sales) is not something to investigate:
// no rules, no hunter, no LLM call. Anything else in the batch sends it through detection.
async function onlyPlainPayments(evs: Ev[]) {
  if (!evs.every((e) => e.schema === "settlement" && e.table === "payments" && e.op === "INSERT")) return false;
  const rows = await db.payment.findMany({ where: { id: { in: evs.map((e) => e.row_id) } }, select: { status: true, order_ref: true } });
  return rows.length === evs.length && rows.every((p) => p.status === "SUCCESS" && !!p.order_ref);
}

// Scoreboard bookkeeping (infra, not the engine): credit the merchant's latest undetected injection.
async function stampInjection(merchant_id: string, case_id: string) {
  const inj = await db.injection.findFirst({ where: { merchant_id, detected_case_id: null }, orderBy: { created_at: "desc" } });
  if (inj) await db.injection.updateMany({ where: { id: inj.id, detected_case_id: null }, data: { detected_case_id: case_id, detected_at: new Date() } });
}
