"use client";

import Link from "next/link";
import type { AuditRow } from "@/app/api/ui/audit/route";
import { usePoll } from "@/components/live";
import { ago, inr, time, type Json } from "@/components/format";
import { ActionStatus, Empty, Failed, OriginBadge, Panel, Skeleton, TierBadge } from "@/components/bits";

export function AuditTable() {
  const { data, error } = usePoll<Json<AuditRow>[]>("/api/ui/audit", 3000);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Audit log</h1>
      <Panel>
        {!data ? (
          error ? <Failed what="the audit log" error={error} /> : <Skeleton rows={8} />
        ) : !data.length ? (
          <Empty title="No actions yet">Every fix, approval, rejection and undo is recorded here with who decided it and where.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-3">
                <tr className="border-b border-rule">
                  {["When", "Merchant", "Action", "Amount", "Tier", "Status", "Decided by", "Via", "Found by"].map((h, i) => (
                    <th key={h} className={`px-4 py-2 font-normal whitespace-nowrap ${i === 3 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {data.map((a) => (
                  <tr key={a.id} className="hover:bg-paper-2">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="num">{time(a.created_at)}</span>
                      <div className="text-ink-3">{ago(a.created_at)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/ops/cases/${a.case_id}`} className="rounded font-semibold hover:text-sky-text">{a.business_name}</Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.type.replaceAll("_", " ")}
                      {a.finding && <div className="text-ink-3">{a.finding.title}</div>}
                    </td>
                    <td className="num px-4 py-2.5 text-right">{inr(a.amount)}</td>
                    <td className="px-4 py-2.5"><TierBadge t={a.tier} /></td>
                    <td className="px-4 py-2.5"><ActionStatus s={a.status} /></td>
                    <td className="px-4 py-2.5">{a.decided_by ?? (a.tier === "AUTO" ? "Hisaab (auto)" : "")}</td>
                    <td className="px-4 py-2.5">{a.decided_via === "WHATSAPP" ? "WhatsApp" : a.decided_via === "DASHBOARD" ? "Dashboard" : ""}</td>
                    <td className="px-4 py-2.5">{a.finding && <OriginBadge o={a.finding.origin} />}</td>
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
