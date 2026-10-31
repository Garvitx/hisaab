"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Panel, Skeleton, TierBadge } from "@/components/bits";
import { inr } from "@/components/format";

type P = { auto_limit: number; approval_limit: number; lending_always_escalate: boolean };
const MAX = 10000;
const STEP = 50;

export function PolicyDial() {
  const [p, setP] = useState<P | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/policy", { cache: "no-store" })
      .then((r) => r.json())
      .then(setP)
      .catch(() => setState("error"));
  }, []);

  // Saves live, debounced so a drag sends one PUT when it settles.
  const change = (next: P) => {
    setP(next);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/policy", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ auto_limit: next.auto_limit, approval_limit: next.approval_limit }),
        });
        if (!r.ok) throw new Error();
        setP(await r.json());
        setState("saved");
      } catch {
        setState("error");
        toast.error("Policy not saved, try again");
      }
    }, 250);
  };

  if (!p) return <Panel><Skeleton rows={4} /></Panel>;

  const rows: { key: "auto_limit" | "approval_limit"; label: string; help: string }[] = [
    { key: "auto_limit", label: "Auto limit", help: "Hisaab fixes verified ledger errors up to this amount on its own." },
    { key: "approval_limit", label: "Approval limit", help: "Above the auto limit and up to this, a person approves. Above it, Hisaab escalates." },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="The autonomy dial"
        aside={
          <span className="text-sm text-ink-3" aria-live="polite">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved, live for the next case" : state === "error" ? "Not saved" : "Saves as you drag"}
          </span>
        }
      >
        <div className="flex flex-col gap-8 px-4 py-6 sm:px-6">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-baseline justify-between gap-4">
                <label id={`${r.key}-l`} className="font-semibold text-ink">
                  {r.label}
                </label>
                <span className="num text-3xl font-semibold text-navy">{inr(p[r.key])}</span>
              </div>
              <p className="mb-4 text-sm text-ink-2">{r.help}</p>
              <Slider
                aria-labelledby={`${r.key}-l`}
                min={0}
                max={MAX}
                step={STEP}
                value={p[r.key]}
                onValueChange={(v) => {
                  const n = Array.isArray(v) ? v[0] : v;
                  const next = { ...p, [r.key]: n };
                  if (r.key === "auto_limit" && next.approval_limit < n) next.approval_limit = n;
                  if (r.key === "approval_limit" && next.auto_limit > n) next.auto_limit = n;
                  change(next);
                }}
                className="[&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-track]]:h-2"
              />
              <div className="num mt-1 flex justify-between text-sm text-ink-3">
                <span>{inr(0)}</span>
                <span>{inr(MAX)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="What happens to a finding">
        <ul className="divide-y divide-rule">
          {[
            ["AUTO", `Verified, ${inr(p.auto_limit)} or less`, "Fixed at once, merchant told on WhatsApp, Undo kept"],
            ["APPROVAL", `${inr(p.auto_limit + 1)} to ${inr(p.approval_limit)}, or unverified, or on the merchant's word`, "Waits in the queue and on the ops phone"],
            ["ESCALATE", `Above ${inr(p.approval_limit)}, or anything touching a loan`, "Handed to a person with the full case file"],
          ].map(([t, when, what]) => (
            <li key={t} className="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
              <span><TierBadge t={t} /></span>
              <span className="num font-semibold text-ink">{when}</span>
              <span className="text-ink-2">{what}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
