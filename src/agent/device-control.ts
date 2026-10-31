// Remote Soundbox / EDC control: off, on, or a restart (off, a few seconds, on). The demo's devices
// are simulated, so "power" is the heartbeat: off = 3 h of silence (past the 2 h window in which a
// health check counts as a heartbeat), on = seen now. Only last_seen_at moves, so the outbox trigger
// ignores it and no detection runs. Dashboards polling the device see the switch flip by itself.
import { db } from "@/lib/db";
import { trace } from "./trace";

export type PowerAction = "off" | "on" | "restart";
const RESTART_MS = 6_000;
const offAt = () => new Date(Date.now() - 3 * 3_600_000);

export async function powerDevice(device_id: string, action: PowerAction, o: { merchant_id?: string; by: string; conversation_id?: string | null }) {
  const d = await db.device.findUnique({ where: { id: device_id } });
  if (!d || (o.merchant_id && d.merchant_id !== o.merchant_id)) throw new Error("device not found");
  const t0 = performance.now();
  if (action === "on") await db.device.update({ where: { id: d.id }, data: { last_seen_at: new Date() } });
  else await db.device.update({ where: { id: d.id }, data: { last_seen_at: offAt() } });
  if (action === "restart") {
    await new Promise((r) => setTimeout(r, RESTART_MS));
    await db.device.update({ where: { id: d.id }, data: { last_seen_at: new Date() } });
  }
  await trace({ kind: "ACTION", name: `device.${action}`, conversation_id: o.conversation_id ?? null, payload: { device_id: d.id, merchant_id: d.merchant_id, serial: d.serial, by: o.by }, ms: Math.round(performance.now() - t0) });
  return { device_id: d.id, model: d.model, serial_tail: d.serial.slice(-4), action, online: action !== "off" };
}
