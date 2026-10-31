"use client";

import Link from "next/link";
import { use } from "react";
import type { MerchantDetail as D } from "@/app/api/ui/merchants/[mid]/route";
import { usePoll } from "@/components/live";
import { ago, day, dayYear, inr, month, type Json } from "@/components/format";
import { CaseStatus, Empty, Failed, OriginBadge, Panel, Pill, Skeleton } from "@/components/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type M = Json<D>;

// One table recipe for every ledger: sentence-case heads, horizontal rules, figures right-aligned.
function T({ head, rows, num = [] }: { head: string[]; rows: React.ReactNode[][]; num?: number[] }) {
  if (!rows.length) return <p className="px-4 py-4 text-ink-3">No rows.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-ink-3">
          <tr className="border-b border-rule">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-normal whitespace-nowrap ${num.includes(i) ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2 align-top ${num.includes(j) ? "num text-right whitespace-nowrap" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => (
  <h3 className="border-t border-rule bg-paper-2 px-4 py-1.5 text-sm font-semibold text-ink-2 first:border-t-0">{children}</h3>
);

export function MerchantDetail({ params, qr }: { params: Promise<{ mid: string }>; qr?: React.ReactNode }) {
  const { mid } = use(params);
  const { data: m, error } = usePoll<M>(`/api/ui/merchants/${encodeURIComponent(mid)}`, 3000);

  if (!m)
    return error === "404" ? (
      <Panel><Empty title={`No merchant ${mid}`}>Check the MID in the merchants list.</Empty></Panel>
    ) : error ? (
      <Panel><Failed what="this merchant" error={error} /></Panel>
    ) : (
      <Panel><Skeleton rows={8} /></Panel>
    );

  const p = m.merchant;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div>
        <Link href="/ops/merchants" className="rounded text-sm text-sky-text hover:underline">All merchants</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl">{p.business_name}</h1>
          {p.is_demo && <Pill t="sky">Demo merchant</Pill>}
          <Link href={`/m/${p.id}`} className="rounded text-sm font-semibold text-sky-text hover:underline">
            Open Mera Hisaab
          </Link>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[
            ["MID", p.id],
            ["Owner", p.owner_name],
            ["City", p.city],
            ["Segment", p.segment],
            ["Language", p.language === "hinglish" ? "Hinglish" : p.language === "hi" ? "Hindi" : "English"],
            ["KYC", p.kyc_status],
            ["Onboarded", dayYear(p.onboarded_at)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-3">{k}</dt>
              <dd className="font-semibold capitalize text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {qr}
      </div>

      <Panel title="Cases" aside={<span className="num text-sm text-ink-3">{m.cases.length}</span>}>
        {m.cases.length ? (
          <ul className="divide-y divide-rule">
            {m.cases.map((c) => (
              <li key={c.id}>
                <Link href={`/ops/cases/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-paper-2">
                  <CaseStatus s={c.status} />
                  <span className="min-w-0 flex-1 text-ink">{c.summary}</span>
                  {c.hunter && <OriginBadge o="HUNTER" />}
                  {c.rule && <OriginBadge o="RULE" />}
                  <span className="num font-semibold">{c.amount ? inr(c.amount) : ""}</span>
                  <span className="text-sm text-ink-3">{ago(c.opened_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No cases">Every ledger for this merchant reconciles.</Empty>
        )}
      </Panel>

      <Panel title="Ledgers across six systems">
        <Tabs defaultValue="settlement" className="gap-0">
          <div className="overflow-x-auto border-b border-rule px-4 py-2">
            <TabsList>
              {["settlement", "billing", "logistics", "disputes", "lending"].map((t) => (
                <TabsTrigger key={t} value={t} className="px-3 capitalize">{t}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="settlement">
            <Sub>Settlements, last 21 days</Sub>
            <T
              head={["Date", "Gross", "Deductions", "Net", "Deducted for"]}
              num={[1, 2, 3]}
              rows={m.settlements.map((s) => [
                day(s.date),
                inr(s.gross),
                s.deductions_total ? inr(s.deductions_total) : "",
                inr(s.net),
                s.deductions.map((d) => `${d.type.replace("_", " ").toLowerCase()} ${inr(d.amount)}`).join(", "),
              ])}
            />
            <Sub>Credits</Sub>
            <T head={["When", "Amount", "Reason"]} num={[1]} rows={m.credits.map((c) => [ago(c.created_at), inr(c.amount), c.reason])} />
            <Sub>Payments, latest 25</Sub>
            <T
              head={["When", "Amount", "Status", "Payer", "Order"]}
              num={[1]}
              rows={m.payments.map((x) => [ago(x.created_at), inr(x.amount), x.status.toLowerCase(), x.payer_name ? `${x.payer_name} (${x.payer_vpa})` : x.payer_vpa, x.order_ref ?? "none"])}
            />
          </TabsContent>

          <TabsContent value="billing">
            {m.subscriptions.map((s) => (
              <div key={s.id}>
                <Sub>
                  {s.plan}, {inr(s.monthly_rent)} a month, {s.status.toLowerCase()} since {dayYear(s.started_at)}
                  {s.closed_at && `, closed ${dayYear(s.closed_at)}`}
                </Sub>
                <T
                  head={["Period", "Kind", "Amount", "Status", "Notice sent"]}
                  num={[2]}
                  rows={s.charges.map((c) => [month(c.period), c.kind.replace("_", " ").toLowerCase(), inr(c.amount), c.status.toLowerCase(), c.notice_sent_at ? day(c.notice_sent_at) : ""])}
                />
              </div>
            ))}
            {!m.subscriptions.length && <p className="px-4 py-4 text-ink-3">No subscriptions.</p>}
          </TabsContent>

          <TabsContent value="logistics">
            {m.devices.map((d) => {
              const offline = Date.now() - new Date(d.last_seen_at).getTime() > 30 * 60 * 1000;
              return (
                <div key={d.id}>
                  <Sub>
                    {d.model === "EDC" ? "EDC machine" : "Soundbox"} {d.serial}, {offline ? "offline" : "online"}, last seen {ago(d.last_seen_at)}
                  </Sub>
                  <T head={["When", "Event", "By"]} rows={d.events.map((e) => [dayYear(e.at), e.type.replaceAll("_", " ").toLowerCase(), e.actor])} />
                  {d.replacement_requests.length > 0 && (
                    <T head={["Replacement booked", "Reason", "Status"]} rows={d.replacement_requests.map((r) => [ago(r.created_at), r.reason, r.status.toLowerCase()])} />
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="disputes">
            <T
              head={["Amount", "Reason", "Raised by", "Status", "Contested", "Response due"]}
              num={[0]}
              rows={m.disputes.map((d) => [inr(d.amount), d.reason, d.raised_by_vpa, d.status.toLowerCase(), d.merchant_contested ? "yes" : "no", d.response_due_at ? day(d.response_due_at) : ""])}
            />
          </TabsContent>

          <TabsContent value="lending">
            {m.loans.map((l) => (
              <div key={l.id}>
                <Sub>
                  Loan {inr(l.principal)}, {inr(l.outstanding)} outstanding, {l.status.toLowerCase()}
                  {l.settlement_offer_amount != null && `, settlement offer ${inr(l.settlement_offer_amount)}`}
                </Sub>
                <T head={["When", "Kind", "Amount"]} num={[2]} rows={l.payments.slice(0, 12).map((x) => [dayYear(x.at), x.kind.toLowerCase(), inr(x.amount)])} />
              </div>
            ))}
            {!m.loans.length && <p className="px-4 py-4 text-ink-3">No loans.</p>}
          </TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
