import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

// One client per process; dev HMR would otherwise open a new pool per reload.
const g = globalThis as unknown as { db?: PrismaClient };

export const db =
  g.db ?? new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

if (process.env.NODE_ENV !== "production") g.db = db;
