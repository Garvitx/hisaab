"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MerchantRow } from "@/app/api/ui/merchants/route";
import { usePoll } from "@/components/live";
import { ago, count, inr, type Json } from "@/components/format";
import { Empty, Failed, HealthBadge, Panel, Pill, Skeleton } from "@/components/bits";

type M = Json<MerchantRow>;
const HEALTH = ["all", "issue", "fixed", "clean"] as const;

export function MerchantsTable() {
  const { data, error } = usePoll<M[]>("/api/ui/merchants", 3000);
  const { data: claims } = usePoll<{ shops: { id: string; state: string }[] }>("/api/claim", 5000);
  const taken = new Set((claims?.shops ?? []).filter((s) => s.state === "TAKEN").map((s) => s.id));
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
                            <Smartphone className="size-3" aria-hidden /> Claimed
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
