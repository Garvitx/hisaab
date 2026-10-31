import type { Refs } from "../verifiers";

export type ExecInput = { action_id: string; merchant_id: string; amount: number; refs: Refs; params?: Record<string, unknown> };

// Undo is data, not code: each executor returns the steps that put the ledger back.
export type Step =
  | { op: "charge"; id: string; status: "BILLED" | "DEDUCTED" | "REVERSED"; notice_sent_at: string | null }
  | { op: "credit.delete"; id: string }
  | { op: "subscription"; id: string; status: "ACTIVE" | "CLOSED"; closed_at: string | null }
  | { op: "event.delete"; id: string }
  | { op: "dispute"; id: string; status: "OPEN" | "DEDUCTED" | "CONTESTED" | "WON" | "LOST"; response_text: string | null; evidence: unknown }
  | { op: "replacement"; id: string; status: "BOOKED" | "DISPATCHED" | "DONE" | "CANCELLED" };
export type Inverse = Step[];
export type Executor = (x: ExecInput) => Promise<Inverse>;

export const ids = (refs: Refs, many: string, one: string) =>
  Array.isArray(refs[many]) ? (refs[many] as unknown[]).filter((x): x is string => typeof x === "string")
  : typeof refs[one] === "string" ? [refs[one] as string] : [];

export const ref = (x: ExecInput, k: string) =>
  typeof x.refs[k] === "string" ? (x.refs[k] as string) : typeof x.params?.[k] === "string" ? (x.params[k] as string) : undefined;

export const iso = (d: Date | null) => d?.toISOString() ?? null;
