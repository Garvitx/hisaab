// logistics schema: devices, their heartbeat, events and replacement requests.
import { db } from "@/lib/db";
import type { DeviceEventType, ReplacementStatus } from "@/generated/prisma/client";

export const OFFLINE_MS = 30 * 60_000;
export const isOnline = (d: { last_seen_at: Date }, now = Date.now()) => now - d.last_seen_at.getTime() <= OFFLINE_MS;

// Seeded devices never ping, so a healthy one would look offline 30 min after a reset.
// Checking health stands in for the device's heartbeat: anything seen in the last 2 h pings
// now, while a device that has really gone quiet (device_offline sets 3 h) stays offline.
export const heartbeat = (merchant_id: string) =>
  db.device.updateMany({ where: { merchant_id, last_seen_at: { gte: new Date(Date.now() - 2 * 3_600_000) } }, data: { last_seen_at: new Date() } });

export const devices = (merchant_id: string) =>
  db.device.findMany({
    where: { merchant_id },
    include: { events: { orderBy: { at: "asc" } }, replacement_requests: { orderBy: { created_at: "asc" } } },
  });

export const device = (id: string) =>
  db.device.findUnique({ where: { id }, include: { events: { orderBy: { at: "asc" } } } });

export const addEvent = (device_id: string, type: DeviceEventType, actor = "hisaab", at = new Date()) =>
  db.deviceEvent.create({ data: { device_id, type, actor, at } });

export const deleteEvent = (id: string) => db.deviceEvent.delete({ where: { id } });

export const bookReplacement = (device_id: string, merchant_id: string, reason: string) =>
  db.replacementRequest.create({ data: { device_id, merchant_id, reason } });

export const setReplacement = (id: string, status: ReplacementStatus) =>
  db.replacementRequest.update({ where: { id }, data: { status } });
