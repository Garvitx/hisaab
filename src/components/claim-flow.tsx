"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Smartphone } from "lucide-react";
import { usePoll } from "@/components/live";
import { Panel, Skeleton } from "@/components/bits";
import { cn } from "@/lib/utils";

export type Shop = {
  id: string;
  business_name: string;
  owner_name: string;
  city: string;
  segment: string;
  state: "FREE" | "TAKEN" | "RESERVED";
  held_by?: string;
};
type Claim = { id: string; code: string; business_name: string; wa_link: string; mid: string; owner: string };
const KEY = "hisaab:claim";

const big = "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold transition-colors duration-(--dur-micro) disabled:cursor-not-allowed disabled:opacity-55";

function Waiting({ c, onReset }: { c: Claim; onReset: () => void }) {
  const { data, error } = usePoll<{ status: string; merchant_id?: string }>(`/api/claim?id=${encodeURIComponent(c.id)}`, 2000);
  const status = data?.status ?? (error === "404" ? "REMOVED" : "PENDING");

  if (status === "ACTIVE")
    return (
      <Panel>
        <div className="flex flex-col gap-3 px-5 py-6">
          <CheckCircle2 className="size-10 text-good" aria-hidden />
          <h2 className="text-2xl">
            You are now {c.owner} of {c.business_name}
          </h2>
          <p className="text-ink-2">
            Hisaab will greet you on WhatsApp. Pick your language and ask anything, like &ldquo;Aaj ka hisaab batao&rdquo;, &ldquo;Kal kitna aayega?&rdquo; or
            &ldquo;Loan milega kya?&rdquo;, or send a voice note.
          </p>
          <Link href={`/m/${c.mid}`} className={cn(big, "bg-navy text-navy-ink hover:bg-navy-2")}>
            Watch your shop&rsquo;s dashboard
          </Link>
          <button type="button" onClick={onReset} className="rounded text-sm text-sky-text hover:underline">
            Claim a different shop
          </button>
        </div>
      </Panel>
    );

  if (status === "REMOVED")
    return (
      <Panel>
        <div className="flex flex-col gap-3 px-5 py-6">
          <h2 className="text-xl">This claim was removed</h2>
          <p className="text-ink-2">The host cleared it. Pick a shop again to play.</p>
          <button type="button" onClick={onReset} className={cn(big, "bg-navy text-navy-ink hover:bg-navy-2")}>
            Choose a shop
          </button>
        </div>
      </Panel>
    );

  return (
    <Panel>
      <div className="flex flex-col gap-4 px-5 py-6">
        <p className="text-sm text-ink-3">{c.business_name}</p>
        <h2 className="text-2xl">Step 2: send this code from this phone on WhatsApp</h2>
        <p className="num rounded-xl bg-paper-2 py-4 text-center text-5xl font-semibold tracking-wide text-navy">CLAIM {c.code}</p>
        <a href={c.wa_link} className={cn(big, "bg-good text-paper hover:opacity-90")}>
          Open WhatsApp
        </a>
        <p className="text-center text-ink-3" aria-live="polite">
          Waiting for your message…
        </p>
        <button type="button" onClick={onReset} className="rounded text-sm text-sky-text hover:underline">
          Start over
        </button>
      </div>
    </Panel>
  );
}

export function ClaimFlow() {
  const { data } = usePoll<{ shops: Shop[] }>("/api/claim", 4000);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Shop | null>(null);
  const [phone, setPhone] = useState("+91 ");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);

  // Survive a reload while the judge switches to WhatsApp and back.
  useEffect(() => {
    try {
      const c = localStorage.getItem(KEY);
      if (c) setClaim(JSON.parse(c));
    } catch {}
  }, []);
  const save = (c: Claim | null) => {
    setClaim(c);
    try {
      if (c) localStorage.setItem(KEY, JSON.stringify(c));
      else localStorage.removeItem(KEY);
    } catch {}
  };

  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const valid = /^\d{10}$/.test(digits);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick || !valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mid: pick.id, phone: `+91${digits}` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? `Could not claim (${r.status})`);
      else save({ id: j.id, code: j.code, wa_link: j.wa_link, business_name: j.business_name ?? pick.business_name, mid: pick.id, owner: pick.owner_name });
    } catch {
      setErr("Network error, try again");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    save(null);
    setPick(null);
    setErr(null);
  };

  if (claim) return <Waiting c={claim} onReset={reset} />;

  if (pick)
    return (
      <Panel>
        <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-6">
          <button type="button" onClick={() => setPick(null)} className="w-fit rounded text-sm text-sky-text hover:underline">
            Back to all shops
          </button>
          <div>
            <h2 className="text-2xl">{pick.business_name}</h2>
            <p className="text-ink-3">
              {pick.owner_name}, {pick.city}
            </p>
          </div>
          <label htmlFor="claim-phone" className="font-semibold">
            Your WhatsApp number
          </label>
          <input
            id="claim-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phone.trim().length > 4 && !valid}
            aria-describedby="claim-help"
            className="h-14 rounded-xl border border-rule bg-paper px-4 text-xl"
          />
          <p id="claim-help" className={cn("min-h-[1lh] text-sm", err ? "text-bad" : "text-ink-3")} role={err ? "alert" : undefined}>
            {err ?? "10 digits. You will send one WhatsApp message from this phone to confirm."}
          </p>
          <button type="submit" disabled={busy || !valid} className={cn(big, "bg-navy text-navy-ink hover:bg-navy-2")}>
            {busy ? "Claiming…" : "Claim this shop"}
          </button>
        </form>
      </Panel>
    );

  const shops = (data?.shops ?? []).filter((s) =>
    `${s.business_name} ${s.owner_name} ${s.city} ${s.segment}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Panel>
      <div className="border-b border-rule p-3">
        <label htmlFor="claim-search" className="sr-only">Search shops</label>
        <input
          id="claim-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shop, owner, city"
          className="h-12 w-full rounded-xl border border-rule bg-paper px-4 text-base"
        />
      </div>
      {!data ? (
        <Skeleton rows={6} />
      ) : !shops.length ? (
        <p className="px-4 py-6 text-ink-3">No shop matches &ldquo;{q}&rdquo;.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {shops.map((s) => {
            const free = s.state === "FREE";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!free}
                  onClick={() => setPick(s)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-(--dur-micro) hover:bg-sky-wash disabled:cursor-not-allowed disabled:bg-paper-2 disabled:hover:bg-paper-2"
                >
                  <span className="min-w-0">
                    <span className={cn("block truncate font-semibold", free ? "text-ink" : "text-ink-3")}>{s.business_name}</span>
                    <span className="block truncate text-sm text-ink-3">
                      {s.owner_name}, {s.city}, <span className="capitalize">{s.segment}</span>
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-sm", free ? "font-semibold text-sky-text" : "text-ink-3")}>
                    {free ? "Claim" : s.state === "RESERVED" ? "Live demo shop" : (
                      <span className="inline-flex items-center gap-1">
                        <Smartphone className="size-3.5" aria-hidden /> Taken{s.held_by ? ` (${s.held_by})` : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
