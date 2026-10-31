// lending schema. Hisaab never writes here: lending always goes to a human.
import { db } from "@/lib/db";

export const loans = (merchant_id: string) =>
  db.loan.findMany({ where: { merchant_id }, include: { payments: { orderBy: { at: "asc" } } } });

export const loan = (id: string) =>
  db.loan.findUnique({ where: { id }, include: { payments: { orderBy: { at: "asc" } } } });
