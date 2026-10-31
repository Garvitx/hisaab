import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Demo control: flip a device online/offline. Only last_seen_at moves, so the outbox trigger
// ignores it (no detection run); the concierge's device health sees the change at once.
// Offline = 3 h of silence, beyond the 2 h window in which a check counts as a heartbeat.
export async function POST(req: Request, ctx: RouteContext<"/api/devices/[id]/status">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (typeof body?.online !== "boolean") return NextResponse.json({ error: "body must be { online: boolean }" }, { status: 400 });
  const last_seen_at = new Date(body.online ? Date.now() : Date.now() - 3 * 3_600_000);
  const d = await db.device.update({ where: { id }, data: { last_seen_at } }).catch(() => null);
  if (!d) return NextResponse.json({ error: "device not found" }, { status: 404 });
  return NextResponse.json({ id: d.id, merchant_id: d.merchant_id, model: d.model, online: body.online, last_seen_at });
}
