import { MODEL, create, textOf, wholeSentences } from "./llm";
import { APPROVAL_SYSTEM, NOTIFIER_SYSTEM } from "./prompts";

// Facts in, one message out. Amounts are passed pre-formatted so the model only copies them.
export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

async function write(system: string, facts: unknown) {
  const res = await create({
    model: MODEL.notify(),
    max_tokens: 4096,
    // Writing a short message needs no deliberation: by default haiku-5-5 spent 816 tokens (mostly
    // thinking) on a 500-char alert, which is what cut messages mid-word under the old 1024 limit.
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  });
  return res.stop_reason === "max_tokens" ? wholeSentences(textOf(res)) : textOf(res);
}

export const merchantMessage = (facts: {
  merchant: { name: string; language: string };
  found: string;
  outcome: "fixed" | "awaiting_approval" | "escalated" | "warning" | "undone" | "rejected";
  amounts: Record<string, number>;
  detail?: string;
}) => write(NOTIFIER_SYSTEM, { ...facts, amounts: Object.fromEntries(Object.entries(facts.amounts).map(([k, v]) => [k, inr(v)])) });

export const approvalMessage = (facts: {
  merchant: string;
  mid: string;
  issue: string;
  evidence: string;
  fix: string;
  amount: number;
  reason: string;
}) => write(APPROVAL_SYSTEM, { ...facts, amount: inr(facts.amount) });
