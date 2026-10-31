import { MODEL, json } from "./llm";
import { HUNTER_SYSTEM } from "./prompts";

// The LLM hunts, the engine verifies (CLAUDE.md section 6). Its output only ever
// becomes a finding after a verifier recomputes it from the ledger.
export const CHECKS = [
  "charge_after_return",
  "charge_without_delivery",
  "silent_deduction",
  "orphan_dispute",
  "zombie_loan",
  "duplicate_deduction",
  "deduction_without_source",
  "pickup_never_completed",
] as const;

export type Hypothesis = { title: string; check: (typeof CHECKS)[number]; refs: Record<string, string[]>; why: string };

const SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          check: { type: "string", enum: [...CHECKS] },
          // ponytail: refs is free-form ids keyed by kind (charge_ids, deduction_ids, ...); each verifier reads what it needs.
          refs: {
            type: "object",
            properties: {
              charge_ids: { type: "array", items: { type: "string" } },
              deduction_ids: { type: "array", items: { type: "string" } },
              device_ids: { type: "array", items: { type: "string" } },
              subscription_ids: { type: "array", items: { type: "string" } },
              dispute_ids: { type: "array", items: { type: "string" } },
              loan_ids: { type: "array", items: { type: "string" } },
            },
            required: [],
            additionalProperties: false,
          },
          why: { type: "string" },
        },
        required: ["title", "check", "refs", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["hypotheses"],
  additionalProperties: false,
};

export async function hunt(snapshot: unknown, events: unknown[]): Promise<Hypothesis[]> {
  const out = await json<{ hypotheses: Hypothesis[] }>({
    model: MODEL.hunt(),
    system: HUNTER_SYSTEM,
    user: JSON.stringify({ changed: events, snapshot }),
    schema: SCHEMA,
    meta: { role: "HUNTER" }, // the case doesn't exist yet; cost tracking attributes it afterwards
  });
  return out.hypotheses.filter((h) => CHECKS.includes(h.check));
}
