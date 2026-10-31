// billing schema: subscriptions and their charges.
import { db } from "@/lib/db";
import type { ChargeKind, ChargeStatus, SubscriptionStatus } from "@/generated/prisma/client";
import { chargeBlocker, recordBlock } from "./guards";

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

export const addSubscription = (data: { merchant_id: string; device_id: string; plan: string; monthly_rent: number; started_at: Date }) =>
  db.subscription.create({ data: { ...data, status: "ACTIVE" } });

// Every new charge passes the enabled guard rules first. A blocked one is still recorded, so the
// x-ray shows what was stopped, but as BLOCKED: never deducted, never owed.
export async function addCharge(data: { subscription_id: string; merchant_id: string; period: string; kind: ChargeKind; amount: number; status: ChargeStatus; deducted_in_settlement_id?: string | null }) {
  const rule = await chargeBlocker(data);
  if (!rule) return db.charge.create({ data });
  const ch = await db.charge.create({ data: { ...data, status: "BLOCKED", deducted_in_settlement_id: null } });
  await recordBlock(rule, data.merchant_id, { table: "billing.charges", id: ch.id, kind: ch.kind, period: ch.period, amount: ch.amount, subscription_id: ch.subscription_id });
  return ch;
}
