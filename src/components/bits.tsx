import { Bot, Cog } from "lucide-react";
import { cn } from "@/lib/utils";

const tone = {
  navy: "bg-navy text-navy-ink",
  sky: "bg-sky-wash text-sky-ink",
  good: "bg-good-wash text-good",
  bad: "bg-bad-wash text-bad",
  warn: "bg-warn-wash text-warn",
  quiet: "bg-paper-3 text-ink-2",
} as const;
export type Tone = keyof typeof tone;

export function Pill({ t = "quiet", className, children }: { t?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm leading-none whitespace-nowrap", tone[t], className)}>
      {children}
    </span>
  );
}

const CASE: Record<string, [string, Tone]> = {
  OPEN: ["Open", "sky"],
  AWAITING_MERCHANT: ["Asking merchant", "warn"],
  AWAITING_APPROVAL: ["Needs approval", "warn"],
  RESOLVED: ["Resolved", "good"],
  ESCALATED: ["Escalated", "bad"],
};
export const CaseStatus = ({ s }: { s: string }) => <Pill t={CASE[s]?.[1]}>{CASE[s]?.[0] ?? s}</Pill>;

const ACTION: Record<string, [string, Tone]> = {
  PROPOSED: ["Proposed", "quiet"],
  PENDING: ["Waiting for approval", "warn"],
  EXECUTED: ["Executed", "good"],
  APPROVED: ["Approved", "good"],
  REJECTED: ["Rejected", "bad"],
  UNDONE: ["Undone", "quiet"],
};
export const ActionStatus = ({ s }: { s: string }) => <Pill t={ACTION[s]?.[1]}>{ACTION[s]?.[0] ?? s}</Pill>;

const TIER: Record<string, [string, Tone]> = { AUTO: ["Auto", "sky"], APPROVAL: ["Approval", "warn"], ESCALATE: ["Escalate", "bad"] };
export const TierBadge = ({ t }: { t: string }) => <Pill t={TIER[t]?.[1]}>{TIER[t]?.[0] ?? t}</Pill>;

const HEALTH: Record<string, [string, Tone]> = { clean: ["Clean", "quiet"], issue: ["Issue", "bad"], fixed: ["Fixed", "good"] };
export const HealthBadge = ({ h }: { h: string }) => <Pill t={HEALTH[h]?.[1]}>{HEALTH[h]?.[0] ?? h}</Pill>;

// RULE vs HUNTER is a demo moment: the hunter is the loud one.
export function OriginBadge({ o, size = "sm" }: { o: string; size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return o === "HUNTER" ? (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sky font-semibold text-sky-ink", lg ? "h-8 px-3.5" : "h-6 px-2.5 text-sm")}>
      <Bot className={lg ? "size-4" : "size-3.5"} aria-hidden />
      Hunter AI
    </span>
  ) : (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-3 text-ink-2", lg ? "h-8 px-3.5" : "h-6 px-2.5 text-sm")}>
      <Cog className={lg ? "size-4" : "size-3.5"} aria-hidden />
      Rule engine
    </span>
  );
}

export function Panel({ title, aside, className, children }: { title?: React.ReactNode; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-(--radius-card) border border-rule bg-paper shadow-(--shadow-card)", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="text-base">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-8">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[52ch] text-ink-3">{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-4 py-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded-md bg-paper-3" />
      ))}
    </div>
  );
}

export function Failed({ what, error }: { what: string; error: string }) {
  return (
    <div role="alert" className="px-4 py-6 text-bad">
      Could not load {what} ({error}). Retrying every 1.5 s.
    </div>
  );
}
