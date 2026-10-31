import Anthropic from "@anthropic-ai/sdk";
import { trace } from "./trace";

// Per-role models come from env so they can be swapped on the day (CLAUDE.md section 2).
export const MODEL = {
  converse: () => process.env.MODEL_CONVERSE || "claude-haiku-5-5",
  hunt: () => process.env.MODEL_HUNT || "claude-sonnet-5-5",
  notify: () => process.env.MODEL_NOTIFY || "claude-haiku-5-5",
};

const g = globalThis as unknown as { claude?: Anthropic };
export const claude = (g.claude ??= new Anthropic());

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
}) {
  const { ids } = opts;
  const messages = [...opts.messages];
  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const t = performance.now();
    const res = await claude.messages.create({
      model: opts.model,
      max_tokens: 4096,
      cache_control: { type: "ephemeral" },
      system: opts.system,
      tools: opts.tools,
      messages,
    });
    const ms = Math.round(performance.now() - t);
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const said = textOf(res);
    if (!uses.length || res.stop_reason !== "tool_use") return { text: said, messages, stop: res.stop_reason };
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
export async function json<T>(opts: { model: string; system: string; user: string; schema: Record<string, unknown> }) {
  const res = await claude.messages.create({
    model: opts.model,
    max_tokens: 8192,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: { type: "json_schema", schema: opts.schema } },
  });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  return JSON.parse(textOf(res)) as T;
}
