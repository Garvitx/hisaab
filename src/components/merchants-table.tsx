"use client";

import Link from "next/link";
import { Copy, ExternalLink, Nfc, QrCode, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MerchantRow } from "@/app/api/ui/merchants/route";
import { usePoll } from "@/components/live";
import { ago, count, inr, type Json } from "@/components/format";
import { Empty, Failed, HealthBadge, Panel, Pill, Skeleton } from "@/components/bits";

type M = Json<MerchantRow>;
const HEALTH = ["all", "issue", "fixed", "clean"] as const;

export function MerchantsTable() {
  const { data, error } = usePoll<M[]>("/api/ui/merchants", 3000);
  const { data: claims } = usePoll<{ shops: { id: string; state: string; held_by?: string }[] }>("/api/claim", 5000);
  const taken = new Map((claims?.shops ?? []).filter((s) => s.state === "TAKEN").map((s) => [s.id, s.held_by?.slice(-4) ?? ""]));
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const health = (sp.get("health") ?? "all") as (typeof HEALTH)[number];
  const city = sp.get("city") ?? "";
  const q = sp.get("q") ?? "";

  // Filters live in the URL.
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v && v !== "all") n.set(k, v);
    else n.delete(k);
    router.replace(`${path}${n.size ? `?${n}` : ""}`, { scroll: false });
  };

  const all = data ?? [];
  const cities = [...new Set(all.map((m) => m.city))].sort();
  const tally = (h: string) => (h === "all" ? all.length : all.filter((m) => m.health === h).length);
  const rows = all.filter(
    (m) =>
      (health === "all" || m.health === health) &&
      (!city || m.city === city) &&
      (!q || `${m.id} ${m.business_name} ${m.owner_name}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Merchants</h1>
        <p className="text-ink-3">
          {data ? `${count(tally("issue"))} with an open issue, ${count(tally("fixed"))} fixed, ${count(tally("clean"))} clean` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Health" className="flex rounded-lg border border-rule bg-paper p-0.5">
          {HEALTH.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={health === h}
              onClick={() => set("health", h)}
              className="h-8 rounded-md px-3 text-sm text-ink-2 capitalize transition-colors duration-(--dur-micro) hover:text-ink aria-checked:bg-navy aria-checked:text-navy-ink"
            >
              {h} <span className="num">{data ? tally(h) : ""}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="City"
          value={city}
          onChange={(e) => set("city", e.target.value)}
          className="h-9 rounded-lg border border-rule bg-paper px-2 text-sm"
        >
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          aria-label="Search merchants"
          placeholder="Search name or MID"
          defaultValue={q}
          onChange={(e) => set("q", e.target.value)}
          className="h-9 w-56 rounded-lg border border-rule bg-paper px-3 text-base sm:text-sm"
        />
      </div>

      <Panel>
        {!data ? (
          error ? <Failed what="merchants" error={error} /> : <Skeleton rows={8} />
        ) : !rows.length ? (
          <Empty title="No merchant matches">Clear a filter to see all {count(all.length)}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-3">
                <tr className="border-b border-rule">
                  <th className="px-4 py-2 font-normal whitespace-nowrap">Merchant</th>
                  <th className="px-4 py-2 font-normal whitespace-nowrap">Health</th>
                  <th className="hidden px-4 py-2 font-normal whitespace-nowrap md:table-cell">City</th>
                  <th className="hidden px-4 py-2 font-normal whitespace-nowrap lg:table-cell">Segment</th>
                  <th className="px-4 py-2 text-right font-normal whitespace-nowrap">Cases</th>
                  <th className="hidden px-4 py-2 text-right font-normal whitespace-nowrap sm:table-cell">Credited</th>
                  <th className="hidden px-4 py-2 text-right font-normal whitespace-nowrap md:table-cell">Last case</th>
                  <th className="px-4 py-2 font-normal whitespace-nowrap">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-paper-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/ops/merchants/${m.id}`} className="rounded font-semibold text-ink hover:text-sky-text">
                        {m.business_name}
                      </Link>
                      <div className="flex items-center gap-2 text-ink-3">
                        <span className="num">{m.id}</span>
                        <span>{m.owner_name}</span>
                        {m.is_demo && <Pill t="sky" className="h-5 px-2 text-xs">Demo</Pill>}
                        {taken.has(m.id) && (
                          <Pill t="good" className="h-5 px-2 text-xs">
                            <Smartphone className="size-3" aria-hidden /> Claimed{taken.get(m.id) && <span className="num">••{taken.get(m.id)}</span>}
                          </Pill>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><HealthBadge h={m.health} /></td>
                    <td className="hidden px-4 py-2.5 md:table-cell">{m.city}</td>
                    <td className="hidden px-4 py-2.5 capitalize lg:table-cell">{m.segment}</td>
                    <td className="num px-4 py-2.5 text-right">{m.cases ? `${m.open} open / ${m.cases}` : "0"}</td>
                    <td className="num hidden px-4 py-2.5 text-right sm:table-cell">{m.credited ? inr(m.credited) : ""}</td>
                    <td className="hidden px-4 py-2.5 text-right whitespace-nowrap text-ink-3 md:table-cell">{ago(m.last_case_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        {m.tap_url && <LinkChip icon={<Nfc className="size-3.5" aria-hidden />} label="Tap (NFC)" url={m.tap_url} />}
                        <LinkChip icon={<QrCode className="size-3.5" aria-hidden />} label="Pay QR" url={m.pay_url} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// Open or copy one of a store's signed links (the NFC tap page, the shop's pay page).
function LinkChip({ icon, label, url }: { icon: React.ReactNode; label: string; url: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} link copied`);
    } catch {
      toast.error("Couldn't copy; long-press the link instead");
    }
  };
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm">
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-semibold text-sky-text hover:underline">
        {icon} {label} <ExternalLink className="size-3" aria-hidden />
      </a>
      <button type="button" onClick={copy} aria-label={`Copy ${label} link`} className="rounded p-1 text-ink-3 hover:bg-paper-3 hover:text-ink">
        <Copy className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
