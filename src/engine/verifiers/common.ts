import type { Verdict } from "@/generated/prisma/client";
import * as billing from "@/systems/billing";

export type Refs = Record<string, unknown>;
export type Ctx = { merchant_id?: string };
export type Result = { ok: boolean; verdict: Verdict; amount: number; title: string; refs: Refs };
export type Verifier = (refs: Refs, ctx?: Ctx) => Promise<Result>;

// Hunter refs come from an LLM: read them defensively, never trust their shape.
export const str = (refs: Refs, k: string) => (typeof refs?.[k] === "string" ? (refs[k] as string) : undefined);

export const no = (title: string, refs: Refs): Result => ({ ok: false, verdict: "OK", amount: 0, title, refs });

export const mine = (row: { merchant_id: string } | null | undefined, ctx?: Ctx) =>
  !!row && (!ctx?.merchant_id || row.merchant_id === ctx.merchant_id);

export const periodStart = (period: string) => new Date(`${period}-01T00:00:00Z`);
export const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

// A subscription named directly, or the latest one on a named device.
export async function subscriptionOf(refs: Refs) {
  const id = str(refs, "subscription_id"), device_id = str(refs, "device_id");
  if (id) return billing.subscription(id);
  return device_id ? billing.subscriptionForDevice(device_id) : null;
}
