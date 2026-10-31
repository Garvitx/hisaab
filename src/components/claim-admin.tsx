"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Shop } from "@/components/claim-flow";
import { usePoll } from "@/components/live";
import { ago } from "@/components/format";
import { Panel, Pill, Skeleton } from "@/components/bits";
import { cn } from "@/lib/utils";

type ClaimRow = { id: string; merchant_id: string; phone: string; status: string; created_at: string; activated_at: string | null };

export function ClaimAdmin({ k }: { k: string }) {
  const [n, setN] = useState(0);
  const { data } = usePoll<{ shops: Shop[]; claims?: ClaimRow[] }>(`/api/claim?k=${encodeURIComponent(k)}&n=${n}`, 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const name = new Map((data?.shops ?? []).map((s) => [s.id, s.business_name]));

  const remove = async (body: object, key: string) => {
    setBusy(key);
    try {
      const r = await fetch(`/api/claim?k=${encodeURIComponent(k)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error ?? `Failed (${r.status})`);
      else toast.success(`Removed, ${j.unlinked_phones ?? 0} phone${j.unlinked_phones === 1 ? "" : "s"} unlinked`);
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
      setN((x) => x + 1);
    }
  };

  const claims = data?.claims ?? [];
  return (
    <Panel
      title="Admin: claimed numbers"
      aside={
        <button
          type="button"
          disabled={!!busy || !claims.length}
          onClick={() => {
            if (!arm) {
              setArm(true);
              setTimeout(() => setArm(false), 4000);
              return;
            }
            setArm(false);
            remove({ all: true }, "all");
          }}
          className={cn(
            "h-9 rounded-lg border px-3 text-sm font-semibold transition-colors duration-(--dur-micro) disabled:cursor-not-allowed disabled:opacity-55",
            arm ? "border-bad bg-bad-wash text-bad" : "border-rule bg-paper text-ink-2 hover:border-ink-3",
          )}
        >
          {busy === "all" ? "Removing…" : arm ? "Tap again to remove all" : "Remove all numbers"}
        </button>
      }
    >
      {!data ? (
        <Skeleton rows={3} />
      ) : !claims.length ? (
        <p className="px-4 py-4 text-ink-3">No claims yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-3">
              <tr className="border-b border-rule">
                {["Shop", "Phone", "Status", "Claimed", ""].map((h) => (
                  <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{name.get(c.merchant_id) ?? c.merchant_id}</span>
                    <span className="num block text-ink-3">{c.merchant_id}</span>
                  </td>
                  <td className="num px-4 py-2.5 whitespace-nowrap">{c.phone}</td>
                  <td className="px-4 py-2.5"><Pill t={c.status === "ACTIVE" ? "good" : "warn"}>{c.status === "ACTIVE" ? "Active" : "Pending"}</Pill></td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-3">{ago(c.activated_at ?? c.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => remove({ id: c.id }, c.id)}
                      className="h-8 rounded-lg border border-rule px-3 text-ink-2 transition-colors duration-(--dur-micro) hover:border-bad hover:text-bad disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {busy === c.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
