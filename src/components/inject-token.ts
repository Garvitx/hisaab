import { timingSafeEqual } from "node:crypto";

// Server-only (node:crypto). Same fail-closed check as POST /api/inject: no INJECT_TOKEN set means locked.
export const injectTokenOk = (k: unknown, want = process.env.INJECT_TOKEN): k is string =>
  typeof k === "string" && !!want && k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));
