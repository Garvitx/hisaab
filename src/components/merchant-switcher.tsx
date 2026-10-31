"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import type { MerchantRow } from "@/app/api/ui/merchants/route";
import type { Json } from "@/components/format";
import { usePoll } from "@/components/live";
import { Pill } from "@/components/bits";

type M = Json<MerchantRow>;
const label = (m: M) => `${m.business_name}, ${m.city} (${m.id})`;

// Native <input list> gives a searchable dropdown for free; picking an option navigates.
export function MerchantSwitcher({ mid, mode }: { mid: string; mode: "m" | "demo" }) {
  const router = useRouter();
  const [all, setAll] = useState<M[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: ds, error: dsError } = usePoll<{ active_demo_mid: string }>("/api/demo-settings", 3000);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => setActive(ds?.active_demo_mid ?? null), [ds]);

  useEffect(() => {
    fetch("/api/ui/merchants").then((r) => r.json()).then(setAll).catch(() => {});
  }, []);

  const go = (v: string) => {
    setQ(v);
    const m = all.find((x) => label(x) === v);
    if (!m) return;
    setQ("");
    router.push(mode === "m" ? `/m/${m.id}` : `/demo?mid=${m.id}`, { scroll: false });
  };

  const actAs = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/demo-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active_demo_mid: mid }),
      });
      if (!r.ok) throw new Error();
      setActive((await r.json()).active_demo_mid);
      toast.success("WhatsApp now answers as this merchant");
    } catch {
      toast.error("Could not switch WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  const cur = all.find((m) => m.id === mid);
  const actingAs = all.find((m) => m.id === active);
  const isActive = active === mid;

  return (
    <div className="flex flex-col gap-2 rounded-(--radius-card) border border-rule bg-paper p-3">
      <label htmlFor={`switch-${mode}`} className="text-sm text-ink-3">Merchant</label>
      <input
        id={`switch-${mode}`}
        list={`merchants-${mode}`}
        value={q}
        onChange={(e) => go(e.target.value)}
        placeholder={cur ? label(cur) : mid}
        autoComplete="off"
        className="h-11 rounded-lg border border-rule bg-paper px-3 text-base placeholder:text-ink"
      />
      <datalist id={`merchants-${mode}`}>
        {all.map((m) => (
          <option key={m.id} value={label(m)} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2">
        {isActive ? (
          <Pill t="good">
            <MessageCircle className="size-3.5" aria-hidden /> WhatsApp acts as this merchant
          </Pill>
        ) : (
          <button
            type="button"
            onClick={actAs}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-navy px-3 text-sm font-semibold text-navy transition-colors duration-(--dur-micro) hover:bg-navy hover:text-navy-ink disabled:cursor-not-allowed disabled:opacity-55"
          >
            <MessageCircle className="size-4" aria-hidden />
            {busy ? "Switching…" : "Make WhatsApp act as this merchant"}
          </button>
        )}
        <span className="text-sm text-ink-3">
          {active === null ? (dsError ? "WhatsApp setting unavailable" : "Checking WhatsApp…") : `WhatsApp is acting as ${actingAs ? actingAs.business_name : active}`}
        </span>
      </div>
    </div>
  );
}
