import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// { enabled?: boolean (default true), approved_by?: string }. Turning the guard on marks the root cause
// GUARDED; from then on billing and settlement writes check it for every merchant (src/systems/guards.ts).
export async function POST(req: Request, ctx: RouteContext<"/api/root-causes/[id]/guard">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const enabled = body?.enabled !== false;
  const guard = await db.guardRule.findFirst({ where: { root_cause_id: id }, orderBy: { created_at: "asc" } });
  if (!guard) return NextResponse.json({ error: "no guard proposed for this root cause" }, { status: 404 });
  const [g] = await db.$transaction([
    db.guardRule.update({
      where: { id: guard.id },
      data: { enabled, approved_by: enabled ? (typeof body?.approved_by === "string" ? body.approved_by.slice(0, 80) : "ops dashboard") : guard.approved_by },
    }),
    db.rootCause.update({ where: { id }, data: { status: enabled ? "GUARDED" : "OPEN" } }),
  ]);
  return NextResponse.json(g);
}
