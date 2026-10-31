// settlement schema: payments, settlements, deductions, credits.
import { db } from "@/lib/db";
import type { DeductionType } from "@/generated/prisma/client";
import { deductionBlocker, recordBlock } from "./guards";

export const payment = (id: string) => db.payment.findUnique({ where: { id } });
export const payments = (ids: string[]) => db.payment.findMany({ where: { id: { in: ids } } });

export const settlements = (merchant_id: string, from: Date) =>
  db.settlement.findMany({ where: { merchant_id, date: { gte: from } }, orderBy: { date: "asc" } });

export const deductions = (merchant_id: string, where: { from?: Date; type?: "RENT" | "LATE_FEE" | "DISPUTE" | "LOAN_EMI" | "FEE" } = {}) =>
  db.deduction.findMany({
    where: { merchant_id, type: where.type, created_at: where.from ? { gte: where.from } : undefined },
    include: { settlement: { select: { date: true } } },
    orderBy: { created_at: "asc" },
  });

export const deduction = (id: string) =>
  db.deduction.findUnique({ where: { id }, include: { settlement: { select: { date: true } } } });

export const deductionsBySource = (source_refs: string[]) =>
  db.deduction.findMany({
    where: { source_ref: { in: source_refs } },
    include: { settlement: { select: { date: true } } },
    orderBy: { created_at: "asc" },
  });

export const credits = (merchant_id: string) => db.credit.findMany({ where: { merchant_id }, orderBy: { created_at: "asc" } });

export const addCredit = (data: { merchant_id: string; amount: number; reason: string; action_id: string }) =>
  db.credit.create({ data });

export const deleteCredit = (id: string) => db.credit.delete({ where: { id } });

// The settlement's totals move in the same transaction, so gross - deductions_total = net holds.
// Returns null when a guard blocked it (nothing reaches the ledger).
export async function addDeduction(data: { settlement_id: string; merchant_id: string; type: DeductionType; amount: number; source_ref: string | null; created_at?: Date }) {
  const rule = await deductionBlocker(data);
  if (rule) {
    await recordBlock(rule, data.merchant_id, { table: "settlement.deductions", ...data });
    return null;
  }
  const [d] = await db.$transaction([
    db.deduction.create({ data }),
    db.settlement.update({ where: { id: data.settlement_id }, data: { deductions_total: { increment: data.amount }, net: { decrement: data.amount } } }),
  ]);
  return d;
}
