import { MODEL, claude, textOf } from "./llm";
import { APPROVAL_SYSTEM, NOTIFIER_SYSTEM } from "./prompts";

// Facts in, one message out. Amounts are passed pre-formatted so the model only copies them.
export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

async function write(system: string, facts: unknown) {
  const res = await claude.messages.create({
    model: MODEL.notify(),
    // Devanagari costs several times the tokens of Hinglish; 1024 cut a 3-finding Hindi message mid-sentence.
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  });
  return textOf(res);
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
