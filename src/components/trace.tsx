"use client";

import { time } from "@/components/format";
import { cn } from "@/lib/utils";

type Ev = { id: string; seq: number; kind: string; name: string; payload: unknown; ms: number | null; created_at: string };

const KIND: Record<string, { label: string; cls: string }> = {
  DETECT: { label: "Detect", cls: "bg-navy text-navy-ink" },
  THINK: { label: "Think", cls: "bg-sky-wash text-sky-ink" },
  TOOL_CALL: { label: "Tool call", cls: "bg-paper-3 text-ink-2" },
  TOOL_RESULT: { label: "Result", cls: "bg-paper-3 text-ink-3" },
  POLICY: { label: "Policy", cls: "bg-warn-wash text-warn" },
  ACTION: { label: "Action", cls: "bg-good-wash text-good" },
  MESSAGE: { label: "Message", cls: "bg-wa text-good" },
};

// One line of payload worth reading at a glance; the full JSON sits behind a disclosure.
function gist(p: unknown): string {
  if (p == null) return "";
  if (typeof p === "string") return p;
  if (typeof p !== "object") return String(p);
  const o = p as Record<string, unknown>;
  for (const k of ["summary", "text", "thought", "reason", "decision", "message", "title", "tier"]) if (typeof o[k] === "string") return o[k] as string;
  return Object.entries(o)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export function TraceTimeline({ events, live }: { events: Ev[]; live?: boolean }) {
  return (
    <ol className="divide-y divide-rule">
      {events.map((e) => {
        const k = KIND[e.kind] ?? { label: e.kind, cls: "bg-paper-3 text-ink-2" };
        const g = gist(e.payload);
        return (
          <li key={e.id} className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5", live && "row-in")}>
            <div className="flex flex-col items-start gap-1">
              <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-sm", k.cls)}>{k.label}</span>
              <span className="num text-xs text-ink-3">{time(e.created_at)}</span>
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
                <span className="break-words">{e.name}</span>
                {e.ms != null && <span className="num text-sm font-normal text-ink-3">{e.ms} ms</span>}
              </p>
              {g && <p className="line-clamp-2 text-sm break-words text-ink-2">{g}</p>}
              {e.payload != null && typeof e.payload === "object" && (
                <details className="mt-1 text-sm">
                  <summary className="w-fit cursor-pointer rounded text-sky-text">Payload</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-paper-2 p-2 text-xs whitespace-pre-wrap break-all text-ink-2">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

