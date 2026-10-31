// disputes schema.
import { db } from "@/lib/db";
import type { DisputeStatus, Prisma } from "@/generated/prisma/client";

export const list = (merchant_id: string) => db.dispute.findMany({ where: { merchant_id } });
export const get = (id: string) => db.dispute.findUnique({ where: { id } });

export const set = (
  id: string,
  data: { status?: DisputeStatus; response_text?: string | null; evidence?: Prisma.InputJsonValue | typeof Prisma.DbNull },
) => db.dispute.update({ where: { id }, data });
