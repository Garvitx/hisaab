"use client";

import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import type { CaseDetail } from "@/app/api/ui/cases/[id]/route";
import { usePoll } from "@/components/live";
import { ago, dayYear, inr, seconds, type Json } from "@/components/format";
import { ActionStatus, CaseStatus, Empty, Failed, OriginBadge, Panel, Pill, Skeleton, TierBadge } from "@/components/bits";
import { TraceTimeline } from "@/components/trace";
import { CaseCost } from "@/components/case-cost";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type C = Json<CaseDetail>;
type Verb = "approve" | "reject" | "undo";

const VERDICT: Record<string, string> = {
  WRONG: "Wrong charge",
  WARN: "Warning",
  CONTESTABLE: "Contestable",
  MISMATCH: "Ledger mismatch",
  OK: "OK",
};

function Evidence({ refs }: { refs: unknown }) {
  if (refs == null) return null;
  const entries = Array.isArray(refs)
    ? refs.map((r, i) => [String(i + 1), r] as const)
    : typeof refs === "object"
      ? Object.entries(refs as Record<string, unknown>)
      : [["ref", refs] as const];
  if (!entries.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md bg-paper-2 px-3 py-2 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-ink-2">{k}</dt>
          <dd className="font-mono text-xs leading-5 break-all text-ink-2">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionRow({ a, onDone }: { a: C["actions"][number]; onDone: () => void }) {
  const [busy, setBusy] = useState<Verb | null>(null);
  const can = {
    approve: a.status === "PENDING" || a.status === "PROPOSED",
    reject: a.status === "PENDING" || a.status === "PROPOSED",
    undo: (a.status === "EXECUTED" || a.status === "APPROVED") && a.inverse != null,
  };
  const go = async (v: Verb) => {
    setBusy(v);
    try {
      const r = await fetch(`/api/actions/${a.id}/${v}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decided_by: "ops-dashboard", decided_via: "DASHBOARD" }),
      });
      if (r.status === 404) toast.error("That action route is not live yet");
      else if (!r.ok) toast.error(`Could not ${v}: ${(await r.json().catch(() => null))?.error ?? r.status}`);
      else toast.success(v === "approve" ? "Approved and executed" : v === "reject" ? "Rejected" : "Undone, merchant will be told");
      onDone();
    } catch {
      toast.error("Network error, try again");
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{a.type.replaceAll("_", " ")}</span>
          {a.amount != null && <span className="num font-semibold">{inr(a.amount)}</span>}
          <TierBadge t={a.tier} />
          <ActionStatus s={a.status} />
        </p>
        {a.reasoning && <p className="mt-1 text-sm text-ink-2">{a.reasoning}</p>}
        {a.decided_by && (
          <p className="mt-1 text-sm text-ink-3">
            Decided by {a.decided_by}
            {a.decided_via && ` on ${a.decided_via === "WHATSAPP" ? "WhatsApp" : "the dashboard"}`}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        {can.approve && (
          <Button size="lg" disabled={!!busy} onClick={() => go("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
        )}
        {can.reject && (
          <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("reject")}>
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        )}
        {can.undo && (
          <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("undo")}>
            {busy === "undo" ? "Undoing…" : "Undo"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function CaseView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [nonce, setNonce] = useState(0);
  const { data: c, error } = usePoll<C>(`/api/ui/cases/${encodeURIComponent(id)}?n=${nonce}`);

  if (!c)
    return error === "404" ? (
      <Panel>
        <Empty title="Case not found">It may have been cleared by a demo reset.</Empty>
      </Panel>
    ) : error ? (
      <Panel><Failed what="this case" error={error} /></Panel>
    ) : (
      <Panel><Skeleton rows={6} /></Panel>
    );

  const total = c.findings.reduce((a, f) => a + f.amount, 0);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/ops" className="rounded text-sm text-sky-text hover:underline">
          Back to overview
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl">{c.merchant?.business_name ?? c.merchant_id}</h1>
          <CaseStatus s={c.status} />
        </div>
        <p className="mt-1 max-w-[70ch] text-ink-2">{c.summary}</p>
        <CaseCost c={c} />
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[
            ["Merchant", <Link key="m" href={`/ops/merchants/${c.merchant_id}`} className="rounded text-sky-text hover:underline">{c.merchant_id}</Link>],
            ["Opened", `${dayYear(c.opened_at)}, ${ago(c.opened_at)}`],
            ["Detected in", seconds(c.detect_ms)],
            ["Source", c.source === "DETECTED" ? "Ledger watch" : "Merchant asked"],
            ["At stake", inr(total)],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt className="text-ink-3">{k}</dt>
              <dd className="num font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Findings" aside={<span className="num text-sm text-ink-3">{c.findings.length}</span>}>
            {c.findings.length ? (
              <ul className="divide-y divide-rule">
                {c.findings.map((f) => (
                  <li
                    key={f.id}
                    className={cn("border-l-4 px-4 py-4", f.origin === "HUNTER" ? "border-l-sky bg-sky-wash" : "border-l-ink-3")}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <OriginBadge o={f.origin} size="lg" />
                      <Pill t={f.verdict === "WRONG" || f.verdict === "MISMATCH" ? "bad" : f.verdict === "OK" ? "good" : "warn"}>
                        {VERDICT[f.verdict] ?? f.verdict}
                      </Pill>
                      <Pill t={f.verified ? "good" : "warn"}>{f.verified ? "Verified by engine" : "Unverified"}</Pill>
                      {f.evidence_source === "MERCHANT_CLAIM" && <Pill t="warn">Merchant&rsquo;s word</Pill>}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-4">
                      <h3 className="text-lg">{f.title}</h3>
                      <span className="num shrink-0 text-xl font-semibold">{inr(f.amount)}</span>
                    </div>
                    <p className="text-sm text-ink-3">
                      Check <code className="font-mono text-xs">{f.check}</code>
                    </p>
                    <Evidence refs={f.evidence_refs} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No findings yet">The engine is still verifying.</Empty>
            )}
          </Panel>

          <Panel title="Actions">
            {c.actions.length ? (
              <ul className="divide-y divide-rule">
                {c.actions.map((a) => (
                  <ActionRow key={a.id} a={a} onDone={() => setNonce((n) => n + 1)} />
                ))}
              </ul>
            ) : (
              <Empty title="No actions proposed">Policy has not run on this case yet.</Empty>
            )}
          </Panel>
        </div>

        <Panel title="Trace" aside={<span className="num text-sm text-ink-3">{c.trace_events.length} steps</span>}>
          {c.trace_events.length ? (
            <TraceTimeline events={c.trace_events} />
          ) : (
            <Empty title="No steps recorded">Every agent step writes a trace row; none have landed yet.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
