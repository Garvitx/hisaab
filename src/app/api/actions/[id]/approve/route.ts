import { NextResponse, after } from "next/server";
import { notifyDecision } from "@/agent/outreach";
import { approveAction } from "@/engine/actions";

export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/actions/[id]/approve">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const action = await approveAction(id, { decided_by: typeof body?.decided_by === "string" ? body.decided_by : null, via: "DASHBOARD" });
    // Tell the merchant after responding, so the dashboard button stays snappy.
    after(() => notifyDecision(action.id).catch((e) => console.error("[actions] notify failed", (e as Error)?.message || e)));
    return NextResponse.json(action);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
