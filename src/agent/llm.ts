import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { refreshCaseCost } from "@/lib/cost";
import { llmCostInr } from "@/config/pricing";
import { trace } from "./trace";
import type { LlmRole } from "@/generated/prisma/client";

// Who made an AI call and for which case / chat, so cost tracking can attribute it.
export type CallMeta = { role: LlmRole; case_id?: string | null; conversation_id?: string | null };

// Calls made before their case exists (the hunter) push their llm_calls ids here, so detect can attach
// them once the case is created. AsyncLocalStorage keeps concurrent merchants' runs apart.
export const llmCalls = new AsyncLocalStorage<string[]>();

// One llm_calls row per Anthropic response. Every Anthropic call in the app goes through create(), so this sees all of them.
export async function recordLlmCall(meta: CallMeta, model: string, res: Anthropic.Message, ms: number): Promise<void> {
  const u = res.usage;
  const usage = {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_read_tokens: u?.cache_read_input_tokens ?? 0,
    cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
  };
  const row = await db.llmCall.create({
    data: { role: meta.role, case_id: meta.case_id ?? null, conversation_id: meta.conversation_id ?? null, model: res.model || model, ...usage, cost_inr: llmCostInr(res.model || model, usage), ms },
    select: { id: true },
  });
  llmCalls.getStore()?.push(row.id);
  if (meta.case_id) await refreshCaseCost(meta.case_id);
}

// Per-role models come from env so they can be swapped on the day (CLAUDE.md section 2).
export const MODEL = {
  converse: () => process.env.MODEL_CONVERSE || "claude-haiku-5-5",
  hunt: () => process.env.MODEL_HUNT || "claude-sonnet-5-5",
  notify: () => process.env.MODEL_NOTIFY || "claude-haiku-5-5",
};

const g = globalThis as unknown as { claude?: Anthropic };
export const claude = (g.claude ??= new Anthropic());

// messages.create, but a reply cut off by max_tokens is retried once with double the budget
// (haiku-5-5 thinks inside the same budget, so a long Hinglish alert could stop mid-word).
export async function create(params: Anthropic.MessageCreateParamsNonStreaming, meta: CallMeta): Promise<Anthropic.Message> {
  let t = performance.now();
  let res = await claude.messages.create(params);
  await recordLlmCall(meta, params.model, res, Math.round(performance.now() - t)).catch((e) => console.error("[llm] record failed", (e as Error)?.message));
  if (res.stop_reason !== "max_tokens") return res;
  console.warn("[llm] hit max_tokens, retrying", params.model, params.max_tokens, res.usage?.output_tokens);
  t = performance.now();
  res = await claude.messages.create({ ...params, max_tokens: params.max_tokens * 2 });
  await recordLlmCall(meta, params.model, res, Math.round(performance.now() - t)).catch((e) => console.error("[llm] record failed", (e as Error)?.message));
  return res;
}

// Last resort for text that is still cut: end at the last full sentence, never mid-word.
export function wholeSentences(t: string) {
  const end = Math.max(...[".", "!", "?", "।", "\n"].map((c) => t.lastIndexOf(c)));
  return end > t.length * 0.5 ? t.slice(0, end + 1).trim() : t.trim();
}

export const textOf = (m: Anthropic.Message) =>
  m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

export type ToolExec = (name: string, input: Record<string, unknown>) => Promise<unknown>;

// Manual loop so every step lands in trace_events (rule 4). A tool that throws is
// returned to the model as is_error rather than killing the turn.
export async function runTools(opts: {
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  exec: ToolExec;
  maxSteps?: number;
  ids: { case_id?: string | null; conversation_id?: string | null };
  role?: LlmRole;
}) {
  const { ids } = opts;
  const messages = [...opts.messages];
  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const t = performance.now();
    const res = await create({
      model: opts.model,
      max_tokens: 4096,
      cache_control: { type: "ephemeral" },
      system: opts.system,
      tools: opts.tools,
      messages,
    }, { role: opts.role ?? "CONCIERGE", case_id: ids.case_id, conversation_id: ids.conversation_id });
    const ms = Math.round(performance.now() - t);
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const said = textOf(res);
    if (!uses.length || res.stop_reason !== "tool_use") return { text: res.stop_reason === "max_tokens" ? wholeSentences(said) : said, messages, stop: res.stop_reason };
    if (said) await trace({ ...ids, kind: "THINK", name: "think", payload: { text: said }, ms });

    // Parallel tool calls: run together, answer in ONE user message.
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
        await trace({ ...ids, kind: "TOOL_CALL", name: u.name, payload: u.input });
        const t0 = performance.now();
        try {
          const out = await opts.exec(u.name, u.input as Record<string, unknown>);
          await trace({ ...ids, kind: "TOOL_RESULT", name: u.name, payload: out, ms: Math.round(performance.now() - t0) });
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out ?? null) };
        } catch (err) {
          const error = (err as Error)?.message || String(err);
          await trace({ ...ids, kind: "TOOL_RESULT", name: u.name, payload: { error }, ms: Math.round(performance.now() - t0) });
          return { type: "tool_result", tool_use_id: u.id, content: error, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { text: "", messages, stop: "max_steps" as const };
}

// One structured-output call: the API constrains the response to `schema`.
export async function json<T>(opts: { model: string; system: string; user: string; schema: Record<string, unknown>; meta: CallMeta }) {
  const res = await create({
    model: opts.model,
    max_tokens: 8192,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: { type: "json_schema", schema: opts.schema } },
  }, opts.meta);
  if (res.stop_reason === "refusal") throw new Error("model refused");
  if (res.stop_reason === "max_tokens") throw new Error("hunter output cut off");
  return JSON.parse(textOf(res)) as T;
}
