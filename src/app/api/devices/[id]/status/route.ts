import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { powerDevice } from "@/agent/device-control";
import { say } from "@/agent/outreach";

export const maxDuration = 60;

// Demo control: flip a device online/offline. Only last_seen_at moves, so the outbox trigger
// ignores it (no detection run); the concierge's device health sees the change at once.
// Offline = 3 h of silence, beyond the 2 h window in which a check counts as a heartbeat.
export async function POST(req: Request, ctx: RouteContext<"/api/devices/[id]/status">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  // Remote restart from ops: answer now, power-cycle in the background, then tell the merchant.
  if (body?.action === "restart") {
    const d = await db.device.findUnique({ where: { id } });
    if (!d) return NextResponse.json({ error: "device not found" }, { status: 404 });
    after(async () => {
      await powerDevice(id, "restart", { by: "ops-dashboard" });
      const m = await db.merchant.findUnique({ where: { id: d.merchant_id } });
      if (m) await say(m, `Namaste ${m.owner_name.split(" ")[0]} ji, Paytm team ne aapka Soundbox remotely restart kiya hai aur ab woh online hai. Ek chhota test payment karke dekh lijiye.`).catch(() => null);
    });
    return NextResponse.json({ id, merchant_id: d.merchant_id, model: d.model, action: "restart", online: false, restarting: true });
  }
  if (typeof body?.online !== "boolean") return NextResponse.json({ error: "body must be { online: boolean } or { action: 'restart' }" }, { status: 400 });
  const last_seen_at = new Date(body.online ? Date.now() : Date.now() - 3 * 3_600_000);
  const d = await db.device.update({ where: { id }, data: { last_seen_at } }).catch(() => null);
  if (!d) return NextResponse.json({ error: "device not found" }, { status: 404 });
  return NextResponse.json({ id: d.id, merchant_id: d.merchant_id, model: d.model, online: body.online, last_seen_at });
}
