// settlement schema: payments, settlements, deductions, credits.
import { db } from "@/lib/db";

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
