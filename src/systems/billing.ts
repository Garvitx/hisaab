// billing schema: subscriptions and their charges.
import { db } from "@/lib/db";
import type { ChargeStatus, SubscriptionStatus } from "@/generated/prisma/client";

export const subscriptions = (merchant_id: string) =>
  db.subscription.findMany({ where: { merchant_id }, include: { charges: { orderBy: { period: "asc" } } } });

export const subscription = (id: string) =>
  db.subscription.findUnique({ where: { id }, include: { charges: { orderBy: { period: "asc" } } } });

export const chargesFor = (merchant_id: string, where: { status?: ChargeStatus; periodFrom?: string } = {}) =>
  db.charge.findMany({
    where: { merchant_id, status: where.status, period: where.periodFrom ? { gte: where.periodFrom } : undefined },
    orderBy: { period: "asc" },
  });

export const charges = (ids: string[]) => db.charge.findMany({ where: { id: { in: ids } } });

export const setCharge = (id: string, data: { status?: ChargeStatus; notice_sent_at?: Date | null }) =>
  db.charge.update({ where: { id }, data });

export const setCharges = (ids: string[], data: { status?: ChargeStatus; notice_sent_at?: Date | null }) =>
  db.charge.updateMany({ where: { id: { in: ids } }, data });

export const setSubscription = (id: string, data: { status: SubscriptionStatus; closed_at: Date | null }) =>
  db.subscription.update({ where: { id }, data });

export const subscriptionForDevice = (device_id: string) =>
  db.subscription.findFirst({ where: { device_id }, include: { charges: { orderBy: { period: "asc" } } }, orderBy: { started_at: "desc" } });
