import { connection } from "next/server";
import { db } from "@/lib/db";
import { getScoreboard } from "@/lib/scoreboard";

// Test lab only (UI, not agent code): reading hisaab.injections is allowed, as on the scoreboard.
// Latest injection per type, matched to its case the same way the scoreboard matches.
async function load() {
  const [injections, scoreboard, merchants] = await Promise.all([
    db.injection.findMany({ orderBy: { created_at: "desc" }, take: 300 }),
    getScoreboard(),
    db.merchant.findMany({ select: { id: true, business_name: true } }),
  ]);
  const latest = new Map<string, (typeof injections)[number]>();
  for (const i of injections) if (!latest.has(i.type)) latest.set(i.type, i);
  const rows = [...latest.values()];
  if (!rows.length) return { scoreboard, rows: [] };

  const mids = [...new Set(rows.map((r) => r.merchant_id))];
  const since = new Date(Math.min(...rows.map((r) => r.created_at.getTime())));
  const [cases, messages] = await Promise.all([
    db.case.findMany({
      where: { OR: [{ merchant_id: { in: mids }, opened_at: { gte: since } }, { id: { in: rows.map((r) => r.detected_case_id).filter((x): x is string => !!x) } }] },
      orderBy: { opened_at: "asc" },
      include: {
        findings: { select: { origin: true, check: true, amount: true, verified: true } },
        actions: { select: { type: true, amount: true, tier: true, status: true }, orderBy: { created_at: "asc" } },
      },
    }),
    db.message.findMany({
      where: { direction: "OUT", created_at: { gte: since }, conversation: { merchant_id: { in: mids } } },
      select: { created_at: true, type: true, text: true, audience: true, conversation: { select: { merchant_id: true } } },
      orderBy: { created_at: "asc" },
    }),
  ]);
  const name = new Map(merchants.map((m) => [m.id, m.business_name]));

  return {
    scoreboard,
    rows: rows.map((i) => {
      const t = i.created_at.getTime();
      const c =
        cases.find((x) => x.id === i.detected_case_id) ??
        cases.find((x) => x.merchant_id === i.merchant_id && x.opened_at.getTime() >= t) ??
        null;
      const out = messages.filter((m) => m.conversation.merchant_id === i.merchant_id && m.created_at.getTime() >= t);
      return {
        id: i.id,
        type: i.type,
        is_decoy: i.is_decoy,
        merchant_id: i.merchant_id,
        business_name: name.get(i.merchant_id) ?? i.merchant_id,
        created_at: i.created_at,
        detected_at: i.detected_at,
        case: c && {
          id: c.id,
          status: c.status,
          opened_at: c.opened_at,
          detect_ms: c.detect_ms ?? c.opened_at.getTime() - t,
          findings: c.findings,
          actions: c.actions,
        },
        messages: { count: out.length, voice: out.some((m) => m.type === "VOICE"), last: out.at(-1)?.text ?? null },
      };
    }),
  };
}
export type Lab = Awaited<ReturnType<typeof load>>;
export type LabRow = Lab["rows"][number];

export async function GET() {
  await connection();
  return Response.json(await load());
}
