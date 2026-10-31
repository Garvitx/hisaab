"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, Download, FileText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { Overview } from "@/app/api/ui/overview/route";
import { count, inr, type Json } from "@/components/format";
import { Pill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import "./root-cause.css";

type RC = Json<Overview>["rootCauses"][number];

// Just enough markdown for the model's ticket: headings, lists, pipe tables, **bold**, `code`.
// Rendered as React nodes, never HTML, so nothing the model writes can inject markup.
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
    : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code>
    : p,
  );
}
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function Markdown({ md }: { md: string }) {
  const lines = md.split("\n"), out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    const h = /^(#{1,3})\s+(.*)/.exec(l);
    if (h) {
      const H = (["h3", "h4", "h5"] as const)[h[1].length - 1];
      out.push(<H key={i}>{inline(h[2])}</H>);
      i++;
    } else if (l.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i]));
      const [head, ...body] = rows;
      if (head) out.push(
        <div key={i} className="rc-md-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(<ul key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
    } else if (l.trim()) {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i].trim());
      out.push(<p key={i}>{inline(para.join(" "))}</p>);
    } else i++;
  }
  return <div className="rc-md">{out}</div>;
}

const where = (sig: unknown) => {
  const s = (sig ?? {}) as Record<string, string | null>;
  const head = s.location ? `Warehouse ${s.location}` : s.actor ? `Field agent ${s.actor}` : s.window ? `Returns in ${s.window}` : s.plan ? `Plan ${s.plan}` : "Shared pattern";
  return s.since ? `${head}, since ${s.since}` : head;
};

const GUARD: Record<string, (p: Record<string, string>) => string> = {
  pause_rent_after_warehouse_receipt: (p) => `Pause rent and fees once ${p.location} scans a device in`,
  block_duplicate_deduction: () => "Block a second deduction for the same charge",
  block_charge_without_delivery: () => "Block rent on devices never delivered",
};

function Ticket({ rc }: { rc: RC }) {
  const md = rc.ticket_md ?? "";
  const copy = () => navigator.clipboard.writeText(md).then(() => toast("Ticket copied"), () => toast("Could not copy"));
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `root-cause-${rc.id.slice(-6)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="gap-1.5" disabled={!md} />}>
        <FileText aria-hidden />
        View ticket
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto bg-paper p-0 sm:max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3 pr-12">
          <DialogTitle className="text-lg">Engineering ticket</DialogTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={copy}><Copy aria-hidden />Copy</Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={download}><Download aria-hidden />Download .md</Button>
          </div>
        </div>
        <div className="px-5 py-4"><Markdown md={md} /></div>
      </DialogContent>
    </Dialog>
  );
}

function Card({ rc }: { rc: RC }) {
  const [busy, setBusy] = useState(false);
  const guard = rc.guards[0];
  const merchants = (rc.affected_merchants ?? []) as string[];
  const enable = async () => {
    setBusy(true);
    const res = await fetch(`/api/root-causes/${encodeURIComponent(rc.id)}/guard`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    setBusy(false);
    toast(res?.ok ? "Guard on: matching charges are blocked for every merchant" : "Could not enable the guard");
  };
  return (
    <section className="rc-card" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg">Root cause found</h2>
          <p className="text-sm text-ink-3">{where(rc.signature)}</p>
        </div>
        <div className="text-right">
          <p className="num text-2xl font-semibold text-bad">{inr(rc.total_amount)}</p>
          <p className="text-sm text-ink-3">wrongly charged across {count(merchants.length)} merchants</p>
        </div>
      </div>
      <p className="mt-2 max-w-[75ch] text-ink-2">{rc.summary ?? "Writing the summary and ticket."}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Affected merchants">
        {merchants.map((mid) => (
          <li key={mid}>
            <Link href={`/ops/merchants/${mid}`} className="num inline-flex h-7 items-center rounded-full border border-rule bg-paper px-2.5 text-sm text-sky-text hover:bg-sky-wash">
              {mid}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Ticket rc={rc} />
        {guard?.enabled ? (
          <Pill t="good" className="h-8 px-3">
            <ShieldCheck className="size-4" aria-hidden />
            Guarded, blocked {count(guard.blocked_count)} {guard.blocked_count === 1 ? "charge" : "charges"}
          </Pill>
        ) : guard ? (
          <Button onClick={enable} disabled={busy} className="gap-1.5">
            <ShieldCheck aria-hidden />
            {busy ? "Enabling" : "Enable guard"}
          </Button>
        ) : (
          <span className="text-sm text-ink-3">No guard proposed yet</span>
        )}
        {guard && <span className="text-sm text-ink-3">{GUARD[guard.template]?.((guard.params ?? {}) as Record<string, string>) ?? guard.template}</span>}
      </div>
    </section>
  );
}

export function RootCauses({ list }: { list: RC[] }) {
  if (!list.length) return null;
  return <div className="flex flex-col gap-3">{list.map((rc) => <Card key={rc.id} rc={rc} />)}</div>;
}
