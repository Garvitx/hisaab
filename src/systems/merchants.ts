// merchants schema. Read only for Hisaab.
import { db } from "@/lib/db";

export const get = (id: string) => db.merchant.findUnique({ where: { id } });
export const byPhone = (phone: string) => db.merchant.findUnique({ where: { phone } });
export const list = () => db.merchant.findMany({ orderBy: { id: "asc" } });
