import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Direct (unpooled) connection: schema pushes and LISTEN need a real session.
  datasource: { url: env("DATABASE_URL_UNPOOLED") },
  migrations: { seed: "tsx prisma/seed.ts" },
});
