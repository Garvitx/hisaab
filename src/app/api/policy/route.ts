import { connection } from "next/server";
import { db } from "@/lib/db";

const DEFAULTS = { id: 1, auto_limit: 1000, approval_limit: 5000, lending_always_escalate: true };
const MAX = 50000;

export async function GET() {
  await connection();
  const p = await db.policy.findUnique({ where: { id: 1 } });
  return Response.json(p ?? DEFAULTS);
}

// Body: { auto_limit?, approval_limit? } in whole rupees. approval_limit is kept >= auto_limit.
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX ? v : undefined);
  const cur = (await db.policy.findUnique({ where: { id: 1 } })) ?? DEFAULTS;
  const auto = int(body?.auto_limit) ?? cur.auto_limit;
  const approval = int(body?.approval_limit) ?? cur.approval_limit;
  if (body?.auto_limit !== undefined && int(body.auto_limit) === undefined)
    return Response.json({ error: `auto_limit must be an integer 0..${MAX}` }, { status: 400 });
  if (body?.approval_limit !== undefined && int(body.approval_limit) === undefined)
    return Response.json({ error: `approval_limit must be an integer 0..${MAX}` }, { status: 400 });
  const data = { auto_limit: auto, approval_limit: Math.max(approval, auto) };
  const p = await db.policy.upsert({ where: { id: 1 }, create: { ...DEFAULTS, ...data }, update: data });
  return Response.json(p);
}
