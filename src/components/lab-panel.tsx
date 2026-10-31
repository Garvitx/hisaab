"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Cog, MessageCircle } from "lucide-react";
import type { Lab, LabRow } from "@/app/api/ui/lab/route";
import { useHeartbeat, usePoll } from "@/components/live";
import { ago, inr, seconds, type Json } from "@/components/format";
import { Panel, Pill, Skeleton, TierBadge, ActionStatus, type Tone } from "@/components/bits";
import { Scoreboard } from "@/components/scoreboard";
import { SPEC, verdict, type Catcher } from "@/components/lab-spec";
import { cn } from "@/lib/utils";

type Item = { type: string; label: string; amount: number | null; options: string[] };
type Catalog = { types: Item[]; decoys: Item[] };
type Row = Json<LabRow>;
type Target = { mode: "demo" | "random" | "mid"; mid: string; failed: boolean };

const CATCHER: Record<Catcher, { label: string; icon: React.ReactNode; cls: string }> = {
  RULE: { label: "Rule engine", icon: <Cog className="size-3.5" aria-hidden />, cls: "border border-ink-3 text-ink-2" },
  HUNTER: { label: "AI hunter", icon: <Bot className="size-3.5" aria-hidden />, cls: "bg-sky font-semibold text-sky-ink" },
  CONCIERGE: { label: "Concierge question", icon: <MessageCircle className="size-3.5" aria-hidden />, cls: "bg-wa text-good" },
  DECOY: { label: "Decoy", icon: null, cls: "bg-paper-3 text-ink-2" },
};
const CHIP: Record<string, Tone> = { pass: "good", fail: "bad", wait: "warn", manual: "sky" };
const CHIP_WORD: Record<string, string> = { pass: "PASS", fail: "FAIL", wait: "Running", manual: "Manual" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Result({ type, r }: { type: string; r: Row | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!r) return <p className="text-sm text-ink-3">Not injected yet.</p>;
  const v = verdict(type, r);
  const c = r.case;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill t={CHIP[v.state]} className="font-semibold">{CHIP_WORD[v.state]}</Pill>
        <span className="text-ink-2">{v.label}</span>
      </div>
      <p className="text-ink-2">
        Injected {ago(r.created_at)} on{" "}
        <Link href={`/ops/merchants/${r.merchant_id}`} className="rounded font-semibold text-ink hover:text-sky-text">
          {r.business_name}
        </Link>{" "}
        <span className="num text-ink-3">{r.merchant_id}</span>
      </p>
      {c ? (
        <>
          <p className="text-ink-2">
            Detected in <span className="num font-semibold text-ink">{seconds(c.detect_ms)}</span>,{" "}
            <Link href={`/ops/cases/${c.id}`} className="rounded font-semibold text-sky-text hover:underline">
              open case
            </Link>
            {c.findings.some((f) => f.origin === "HUNTER") && <span className="ml-2 font-semibold text-sky-text">found by the hunter</span>}
          </p>
          {c.actions.length > 0 && (
            <ul className="flex flex-col gap-1">
              {c.actions.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-ink">{a.type.replaceAll("_", " ")}</span>
                  {a.amount != null && a.amount > 0 && <span className="num font-semibold">{inr(a.amount)}</span>}
                  <TierBadge t={a.tier} />
                  <ActionStatus s={a.status} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        SPEC[type]?.catcher !== "DECOY" && SPEC[type]?.catcher !== "CONCIERGE" && <p className="text-ink-3">No case yet.</p>
      )}
      <p className={r.messages.count ? "text-good" : "text-ink-3"}>
        {r.messages.count
          ? `WhatsApp: ${r.messages.count} message${r.messages.count > 1 ? "s" : ""} sent${r.messages.voice ? ", with a voice note" : ""}`
          : "WhatsApp: nothing sent yet"}
      </p>
    </div>
  );
}

export function LabPanel({ k }: { k: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [mids, setMids] = useState<{ id: string; business_name: string }[]>([]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const { data: lab } = usePoll<Json<Lab>>("/api/ui/lab");
  useHeartbeat();

  useEffect(() => {
    fetch("/api/inject").then((r) => r.json()).then(setCat).catch(() => setCat({ types: [], decoys: [] }));
    fetch("/api/ui/merchants").then((r) => r.json()).then(setMids).catch(() => {});
  }, []);

  const tgt = (type: string): Target => targets[type] ?? { mode: "demo", mid: "", failed: false };
  const setT = (type: string, p: Partial<Target>) => setTargets((t) => ({ ...t, [type]: { ...tgt(type), ...p } }));

  const post = async (body: object, key: string) => {
    setBusy(key);
    try {
      const r = await fetch(`/api/inject?k=${encodeURIComponent(k)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) toast.error(`Failed: ${j.error ?? r.status}`);
      else toast.success(j.reset ? "Reset done" : (j.summary ?? "Injected"), { description: j.merchant_id ? `On ${j.merchant_id}` : undefined });
      return r.ok;
    } catch {
      toast.error("Network error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const inject = (it: Item, decoy: boolean, override?: Partial<Target>) => {
    const t = { ...tgt(it.type), ...override };
    if (t.mode === "mid" && !t.mid) return toast.error("Pick a merchant first");
    return post({ type: it.type, target: t.mode === "mid" ? t.mid : t.mode, decoy, failed: t.failed }, it.type);
  };

  const runAll = async (items: Item[], decoy: boolean) => {
    if (runningAll) return;
    setRunningAll(true);
    try {
      for (const [i, it] of items.entries()) {
        if (i) await sleep(3000);
        await inject(it, decoy, { mode: "random", failed: false });
      }
    } finally {
      setRunningAll(false);
    }
  };

  const byType = new Map((lab?.rows ?? []).map((r) => [r.type, r]));
  const verdicts = (lab?.rows ?? []).map((r) => verdict(r.type, r).state);
  const tally = { pass: verdicts.filter((v) => v === "pass").length, fail: verdicts.filter((v) => v === "fail").length };

  const section = (title: string, items: Item[], decoy: boolean) => (
    <Panel
      title={title}
      aside={
        <button
          type="button"
          disabled={!!busy || runningAll}
          onClick={() => runAll(items, decoy)}
          className="h-9 rounded-lg border border-navy px-3 text-sm font-semibold text-navy transition-colors duration-(--dur-micro) hover:bg-navy hover:text-navy-ink disabled:cursor-not-allowed disabled:opacity-55"
        >
          {runningAll ? "Running…" : "Run all on Random"}
        </button>
      }
    >
      <ul className="divide-y divide-rule">
        {items.map((it) => {
          const s = SPEC[it.type];
          const c = CATCHER[s?.catcher ?? (decoy ? "DECOY" : "RULE")];
          const t = tgt(it.type);
          return (
            <li key={it.type} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,5fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg">{it.label}</h3>
                  <code className="font-mono text-xs text-ink-3">{it.type}</code>
                  <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-sm", c.cls)}>
                    {c.icon}
                    {c.label}
                  </span>
                </div>
                {s && <p className="mt-1 text-ink-2">{s.writes}</p>}
                <p className="mt-1">
                  <span className="text-ink-3">Expected: </span>
                  <span className={cn("font-semibold", decoy ? "text-bad" : "text-ink")}>{s?.expected ?? "Not written yet"}</span>
                </p>
                {s?.ask && (
                  <p className="mt-1 text-sm text-ink-2">
                    Then ask on WhatsApp: <span className="font-semibold text-ink">&ldquo;{s.ask}&rdquo;</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <select
                  aria-label={`Target for ${it.label}`}
                  value={t.mode === "mid" ? t.mid : t.mode}
                  onChange={(e) => {
                    const v = e.target.value;
                    setT(it.type, v === "demo" || v === "random" ? { mode: v } : { mode: "mid", mid: v });
                  }}
                  className="h-10 rounded-lg border border-rule bg-paper px-2 text-base sm:text-sm"
                >
                  <option value="demo">Demo, MID-0001</option>
                  <option value="random">Random merchant</option>
                  {mids.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} {m.business_name}
                    </option>
                  ))}
                </select>
                {it.options.includes("failed") && (
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={t.failed} onChange={(e) => setT(it.type, { failed: e.target.checked })} className="size-4 accent-navy" />
                    Payment failed instead of pending
                  </label>
                )}
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => inject(it, decoy)}
                  className="h-10 rounded-lg bg-navy px-4 font-semibold text-navy-ink transition-colors duration-(--dur-micro) hover:bg-navy-2 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {busy === it.type ? "Injecting…" : "Inject"}
                </button>
              </div>

              <div aria-live="polite" className="min-w-0 border-t border-rule pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                <Result type={it.type} r={byType.get(it.type)} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Anomaly test lab</h1>
          <p className="text-ink-2">
            Inject each case and check Hisaab does what it should.{" "}
            {lab && lab.rows.length > 0 && (
              <span className="num font-semibold text-ink">
                {tally.pass} pass, {tally.fail} fail
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/demo" className="flex h-9 items-center rounded-lg px-3 font-semibold text-sky-text hover:bg-paper-3">Demo</Link>
          <Link href="/ops/policy" className="flex h-9 items-center rounded-lg px-3 font-semibold text-sky-text hover:bg-paper-3">Policy</Link>
          <button
            type="button"
            disabled={!!busy || runningAll}
            onClick={() => {
              if (!arm) {
                setArm(true);
                setTimeout(() => setArm(false), 4000);
                return;
              }
              setArm(false);
              post({ reset: true }, "reset");
            }}
            className={cn(
              "h-9 rounded-lg border px-3 font-semibold transition-colors duration-(--dur-micro) disabled:cursor-not-allowed disabled:opacity-55",
              arm ? "border-bad bg-bad-wash text-bad" : "border-rule bg-paper text-ink-2 hover:border-ink-3",
            )}
          >
            {busy === "reset" ? "Resetting…" : arm ? "Tap again to wipe and reseed" : "Reset"}
          </button>
        </div>
      </div>

      <Scoreboard s={lab?.scoreboard ?? null} />

      {!cat ? (
        <Panel><Skeleton rows={6} /></Panel>
      ) : (
        <>
          {section("Anomalies", cat.types, false)}
          {section("Decoys", cat.decoys, true)}
        </>
      )}
    </div>
  );
}
