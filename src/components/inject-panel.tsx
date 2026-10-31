"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { inr } from "@/components/format";
import { Panel, Skeleton } from "@/components/bits";
import { cn } from "@/lib/utils";

type Item = { type: string; label: string; amount: number | null; options: string[] };
type Catalog = { types: Item[]; decoys: Item[] };
type Log = { id: number; ok: boolean; text: string; sub?: string };

const btn =
  "flex min-h-14 w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,transform] duration-(--dur-micro) active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

export function InjectPanel({ k }: { k: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [mids, setMids] = useState<{ id: string; business_name: string }[]>([]);
  const [mode, setMode] = useState<"demo" | "random" | "mid">("demo");
  const [mid, setMid] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const [log, setLog] = useState<Log[]>([]);

  useEffect(() => {
    fetch("/api/inject").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setCat).catch(() => setCat({ types: [], decoys: [] }));
    fetch("/api/ui/merchants").then((r) => r.json()).then((m) => setMids(m)).catch(() => {});
  }, []);

  const target = mode === "mid" ? mid : mode;

  const post = async (key: string, body: object) => {
    setBusy(key);
    try {
      const r = await fetch(`/api/inject?k=${encodeURIComponent(k)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      const ok = r.ok && j.ok !== false;
      const text = ok ? (j.reset ? "Reset done, 30 clean merchants" : (j.summary ?? "Injected")) : `Failed: ${j.error ?? r.status}`;
      const sub = ok && j.merchant_id ? `On ${j.merchant_id}` : undefined;
      (ok ? toast.success : toast.error)(text, { description: sub });
      setLog((l) => [{ id: Date.now(), ok, text, sub }, ...l].slice(0, 5));
    } catch {
      toast.error("Network error, try again");
    } finally {
      setBusy(null);
    }
  };

  const fire = (it: Item, decoy: boolean, failed = false) => {
    if (mode === "mid" && !mid) return toast.error("Pick a merchant first");
    post(`${it.type}${failed ? ":failed" : ""}`, { type: it.type, target, decoy, failed });
  };

  const grid = (items: Item[], decoy: boolean) => (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
      {items.flatMap((it) =>
        [false, ...(it.options.includes("failed") ? [true] : [])].map((failed) => {
          const key = `${it.type}${failed ? ":failed" : ""}`;
          return (
            <button
              key={key}
              type="button"
              disabled={!!busy}
              onClick={() => fire(it, decoy, failed)}
              className={cn(btn, decoy ? "border-rule bg-paper-2 hover:border-ink-3" : "border-rule bg-paper hover:border-sky hover:bg-sky-wash")}
            >
              <span className="font-semibold leading-tight text-ink">
                {busy === key ? "Injecting…" : failed ? `${it.label}, failed` : it.label}
              </span>
              {it.amount != null && <span className="num text-sm text-ink-3">{inr(it.amount)}</span>}
            </button>
          );
        }),
      )}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl">Chaos panel</h1>
        <p className="text-ink-2">Break a ledger. Hisaab should catch it within seconds.</p>
      </div>

      <Panel title="Target">
        <div className="flex flex-col gap-3 p-3">
          <div role="radiogroup" aria-label="Target" className="grid grid-cols-3 rounded-xl bg-paper-3 p-1">
            {([["demo", "Ramesh (demo)"], ["random", "Random"], ["mid", "Pick MID"]] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={mode === v}
                onClick={() => setMode(v)}
                className="h-11 rounded-lg text-sm text-ink-2 transition-colors duration-(--dur-micro) aria-checked:bg-navy aria-checked:text-navy-ink"
              >
                {l}
              </button>
            ))}
          </div>
          {mode === "mid" && (
            <select
              aria-label="Merchant"
              value={mid}
              onChange={(e) => setMid(e.target.value)}
              className="h-11 rounded-lg border border-rule bg-paper px-2 text-base"
            >
              <option value="">Choose a merchant</option>
              {mids.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} {m.business_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </Panel>

      <Panel title="Anomalies">
        {!cat ? <Skeleton rows={3} /> : cat.types.length ? grid(cat.types, false) : <p className="p-4 text-ink-3">Injector catalog unavailable.</p>}
      </Panel>

      <Panel title="Decoys" aside={<span className="text-sm text-ink-3">Hisaab should ignore these</span>}>
        {!cat ? <Skeleton rows={1} /> : grid(cat.decoys, true)}
      </Panel>

      {log.length > 0 && (
        <Panel title="Results">
          <ul className="divide-y divide-rule" aria-live="polite">
            {log.map((l) => (
              <li key={l.id} className={cn("row-in px-4 py-2.5", l.ok ? "text-ink" : "text-bad")}>
                {l.text}
                {l.sub && <span className="block text-sm text-ink-3">{l.sub}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-8">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => {
            if (!arm) {
              setArm(true);
              setTimeout(() => setArm(false), 4000);
              return;
            }
            setArm(false);
            post("reset", { reset: true });
          }}
          className={cn(
            "h-11 rounded-xl border px-4 font-semibold transition-colors duration-(--dur-micro) disabled:cursor-not-allowed disabled:opacity-55",
            arm ? "border-bad bg-bad-wash text-bad" : "border-rule bg-paper text-ink-2 hover:border-ink-3",
          )}
        >
          {busy === "reset" ? "Resetting…" : arm ? "Tap again to wipe and reseed" : "Reset demo"}
        </button>
        <span className="text-sm text-ink-3">Truncates every ledger and reseeds 30 clean merchants.</span>
      </div>
    </div>
  );
}
