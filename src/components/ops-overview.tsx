"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Overview } from "@/app/api/ui/overview/route";
import type { CaseRow } from "@/app/api/ui/cases";
import { chime, useHeartbeat, usePoll, type Beat } from "@/components/live";
import { ago, count, inr, seconds, type Json } from "@/components/format";
import { CaseStatus, Empty, Failed, OriginBadge, Panel, Skeleton } from "@/components/bits";
import { Scoreboard } from "@/components/scoreboard";
import { TraceTimeline } from "@/components/trace";
import { cn } from "@/lib/utils";

type O = Json<Overview>;
type Row = Json<CaseRow>;

function WatchPulse({ beat, merchants, waiting }: { beat: Beat | null; merchants: number; waiting: number }) {
  const down = beat && !beat.ok;
  return (
    <div className="flex items-center gap-3 text-sm" aria-live="polite">
      <span className="relative flex size-3 shrink-0" aria-hidden>
        {beat?.ok && <span key={beat.at} className="hb-ring absolute inset-0 rounded-full bg-sky" />}
        <span className={cn("relative size-3 rounded-full", down ? "bg-warn" : beat ? "bg-sky" : "bg-paper-3")} />
      </span>
      <span className="font-semibold text-ink">
        {down ? "Watcher not answering" : `Watching ${merchants ? count(merchants) : "–"} ledgers`}
      </span>
      <span className="text-ink-3">
        {beat ? `swept ${ago(new Date(beat.at))}` : "starting"}
        {waiting > 0 && `, ${count(waiting)} changes queued`}
      </span>
    </div>
  );
}

function CaseList({ rows, active, onPick }: { rows: Row[]; active?: string; onPick: (id: string) => void }) {
  return (
    <ul className="divide-y divide-rule">
      {rows.map((r) => (
        <li key={r.id} className="row-in">
          <button
            type="button"
            onClick={() => onPick(r.id)}
            aria-pressed={active === r.id}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2 aria-pressed:bg-sky-wash"
          >
            <span className="min-w-0 truncate font-semibold text-ink">{r.business_name}</span>
            <span className="num text-right font-semibold text-ink">{r.amount ? inr(r.amount) : ""}</span>
            <span className="min-w-0 truncate text-sm text-ink-2">{r.summary}</span>
            <span className="text-right text-sm whitespace-nowrap text-ink-3">{ago(r.opened_at)}</span>
            <span className="col-span-2 flex flex-wrap items-center gap-1.5 pt-0.5">
              <CaseStatus s={r.status} />
              {r.hunter && <OriginBadge o="HUNTER" />}
              {r.rule && <OriginBadge o="RULE" />}
              {r.detect_ms != null && <span className="num text-sm text-ink-3">caught in {seconds(r.detect_ms)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Queue({ o, active, onPick, compact }: { o: O; active?: string; onPick: (id: string) => void; compact?: boolean }) {
  const groups: [string, Row[]][] = [
    ["Needs a human", o.queue.pending],
    ["Escalated", o.queue.escalated],
    ["Handled by Hisaab", compact ? o.queue.recent.slice(0, 5) : o.queue.recent],
  ];
  if (!o.caseIds.length)
    return (
      <Panel title="Case queue">
        <Empty title={`Sab theek hai, ${count(o.merchants)} merchants watched`}>
          No open cases. Inject an anomaly and it lands here within seconds.
        </Empty>
      </Panel>
    );
  return (
    <Panel title="Case queue" aside={<span className="num text-sm text-ink-3">{count(o.caseIds.length)} cases</span>}>
      {groups.map(([title, rows]) => (
        <div key={title} className="border-b border-rule last:border-b-0">
          <h3 className="flex items-baseline justify-between bg-paper-2 px-4 py-1.5 text-sm font-semibold text-ink-2">
            {title}
            <span className="num font-normal text-ink-3">{rows.length}</span>
          </h3>
          {rows.length ? (
            <CaseList rows={rows} active={active} onPick={onPick} />
          ) : (
            <p className="px-4 py-3 text-sm text-ink-3">Nothing here.</p>
          )}
        </div>
      ))}
    </Panel>
  );
}

function LiveTrace({ o, pinned, onFollow }: { o: O; pinned: boolean; onFollow: () => void }) {
  const a = o.active;
  return (
    <Panel
      title="Live trace"
      aside={
        a && (
          <div className="flex items-center gap-3 text-sm">
            {pinned && (
              <button type="button" onClick={onFollow} className="rounded text-sky-text hover:underline">
                Follow latest
              </button>
            )}
            <Link href={`/ops/cases/${a.id}`} className="rounded font-semibold text-sky-text hover:underline">
              Open case
            </Link>
          </div>
        )
      }
    >
      {a ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-3">
            <span className="font-display text-lg font-semibold">{a.business_name}</span>
            <CaseStatus s={a.status} />
            <p className="w-full text-ink-2">{a.summary}</p>
          </div>
          {o.trace.length ? (
            <TraceTimeline events={o.trace} live />
          ) : (
            <p className="px-4 py-4 text-ink-3">Waiting for the first step of this case.</p>
          )}
        </>
      ) : (
        <Empty title="No case yet">The next detection streams here step by step: think, tool call, policy, action, message.</Empty>
      )}
    </Panel>
  );
}

export function OpsOverview({ variant = "ops", left }: { variant?: "ops" | "demo"; left?: React.ReactNode }) {
  const router = useRouter();
  const [pin, setPin] = useState<string | null>(null);
  const { data: o, error } = usePoll<O>(`/api/ui/overview${pin ? `?case=${encodeURIComponent(pin)}` : ""}`);
  const beat = useHeartbeat();

  // A new case: toast and chime. The first load only seeds what we've seen.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!o) return;
    if (!seen.current) {
      seen.current = new Set(o.caseIds);
      return;
    }
    const fresh = o.caseIds.filter((id) => !seen.current!.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => seen.current!.add(id));
    chime();
    const n = o.newest;
    if (n && fresh.includes(n.id))
      toast(`New case: ${n.business_name}`, {
        description: `${n.summary}${n.amount ? `, ${inr(n.amount)}` : ""}`,
        action: { label: "Open", onClick: () => router.push(`/ops/cases/${n.id}`) },
      });
  }, [o, router]);

  const pulse = <WatchPulse beat={beat} merchants={o?.merchants ?? 0} waiting={o?.waiting ?? 0} />;
  const body = !o ? (
    error ? (
      <Panel><Failed what="the overview" error={error} /></Panel>
    ) : (
      <Panel><Skeleton rows={5} /></Panel>
    )
  ) : null;

  if (variant === "demo")
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Scoreboard s={o?.scoreboard ?? null} />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0">{left}</div>
          <div className="flex min-w-0 flex-col gap-4">
            {pulse}
            {body ?? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <Queue o={o!} active={o!.active?.id} onPick={setPin} compact />
                <LiveTrace o={o!} pinned={!!pin} onFollow={() => setPin(null)} />
              </div>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Ops overview</h1>
        {pulse}
      </div>
      <Scoreboard s={o?.scoreboard ?? null} />
      {body ?? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Queue o={o!} active={o!.active?.id} onPick={setPin} />
          <LiveTrace o={o!} pinned={!!pin} onFollow={() => setPin(null)} />
        </div>
      )}
    </div>
  );
}
