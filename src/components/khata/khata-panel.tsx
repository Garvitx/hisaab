"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import type { KhataView } from "@/app/api/khata/[mid]/route";
import { usePoll } from "@/components/live";
import { inr, type Json } from "@/components/format";
import { Panel, Pill } from "@/components/bits";
import "./khata.css";

type V = Json<KhataView>;
type B = V["balances"][number];

// /m/[mid]: today's money with each source labelled, udhaar per counterparty (Lene hain / Dene hain)
// with Remind, and other shops' requests waiting for a Haan / Nahi.
export function KhataPanel({ mid, nfc }: { mid: string; nfc?: React.ReactNode }) {
  const { data: v } = usePoll<V>(`/api/khata/${encodeURIComponent(mid)}`, 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, { text: string; link?: string }>>({});
  if (!v) return null;
  const t = v.today;

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const r = await fetch("/api/khata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mid, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Nahi ho paaya.");
      return j;
    } catch (e) {
      setNote((n) => ({ ...n, [key]: { text: (e as Error).message } }));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const remind = async (b: B) => {
    const j = await post(b.key, { op: "remind", key: b.key });
    if (j) setNote((n) => ({ ...n, [b.key]: j.sent ? { text: `Reminder bhej diya (${inr(j.amount)}).` } : { text: "Inka phone Hisaab par nahi hai. Ye QR dikhaiye ya link bhejiye:", link: j.link } }));
  };

  const lene = v.balances.filter((b) => b.lene > 0);
  const dene = v.balances.filter((b) => b.dene > 0);
  const disputed = v.balances.filter((b) => b.disputed > 0);
  const who = (b: Pick<B, "name" | "mid">) =>
    b.mid ? <Link href={`/m/${b.mid}`} className="font-semibold text-ink underline-offset-2 hover:underline">{b.name}</Link> : <span className="font-semibold text-ink">{b.name}</span>;

  return (
    <Panel title="Aaj ki kamai" aside={<span className="num text-xl font-semibold">{inr(t.kamai)}</span>}>
      <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3">
        <dt className="text-ink-2">UPI <span className="text-sm text-ink-3">(Paytm se verified)</span></dt>
        <dd>{inr(t.upi.total)}</dd>
        <dt className="text-ink-2">Cash <span className="text-sm text-ink-3">(aapne bataya)</span></dt>
        <dd>{inr(t.cash.total)}</dd>
        <dt className="text-ink-2">Kharcha <span className="text-sm text-ink-3">(aapne bataya)</span></dt>
        <dd className="text-bad">-{inr(t.expenses.total)}</dd>
        <dt className="border-t border-rule pt-1 font-semibold text-ink">Bachat</dt>
        <dd className="border-t border-rule pt-1 font-semibold">{inr(t.net)}</dd>
      </dl>
      {(t.udhaar.given > 0 || t.udhaar.taken > 0 || t.udhaar.received_back > 0) && (
        <p className="num border-t border-rule px-4 py-2 text-sm text-ink-2">
          Aaj udhaar: diya {inr(t.udhaar.given)}, liya {inr(t.udhaar.taken)}, wapas mila {inr(t.udhaar.received_back)}
        </p>
      )}

      {v.requests.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule">
          {v.requests.map((r) => (
            <li key={r.id} className="bg-warn-wash px-4 py-3">
              <p className="text-ink">
                {r.from} ne likha hai ki {r.kind === "UDHAAR_TAKEN" ? "aapko" : "unhe aapko"} <span className="num font-semibold">{inr(r.amount)}</span> dene hain. Sahi hai?
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="kh-btn kh-primary" disabled={!!busy} onClick={() => post(r.id, { op: "respond", id: r.id, accept: true })}>Haan</button>
                <button type="button" className="kh-btn kh-danger" disabled={!!busy} onClick={() => post(r.id, { op: "respond", id: r.id, accept: false })}>Nahi</button>
              </div>
              {note[r.id] && <p role="alert" className="mt-1 text-sm text-bad">{note[r.id].text}</p>}
            </li>
          ))}
        </ul>
      )}

      {lene.length > 0 && (
        <section className="border-t border-rule">
          <h3 className="px-4 pt-3 text-base">Lene hain</h3>
          <ul className="divide-y divide-rule">
            {lene.map((b) => (
              <li key={b.key} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1">{who(b)}</span>
                  {b.waiting_their_ok > 0 && <Pill t="warn">Unki haan baaki</Pill>}
                  <span className="num font-semibold text-good">{inr(b.lene)}</span>
                  {b.lene > 0 && (
                    <button type="button" className="kh-btn kh-ghost" disabled={busy === b.key} onClick={() => remind(b)}>
                      {busy === b.key ? "Bhej rahe…" : "Remind"}
                    </button>
                  )}
                </div>
                {note[b.key] && <ReminderNote {...note[b.key]} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dene.length > 0 && (
        <section className="border-t border-rule">
          <h3 className="px-4 pt-3 text-base">Dene hain</h3>
          <ul className="divide-y divide-rule">
            {dene.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1">{who(b)}</span>
                <span className="num font-semibold text-bad">{inr(b.dene)}</span>
                {b.pay_link && <a href={b.pay_link} className="kh-btn kh-primary">Pay karein</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {disputed.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule">
          {disputed.map((b) => (
            <li key={b.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">{who(b)}</span>
              <Pill t="bad">Vivaad</Pill>
              <span className="num text-ink-2">{inr(b.disputed)}</span>
            </li>
          ))}
        </ul>
      )}

      {nfc && (
        <details className="border-t border-rule">
          <summary className="cursor-pointer px-4 py-3 font-semibold text-ink">NFC sticker</summary>
          {nfc}
        </details>
      )}
    </Panel>
  );
}

// No phone on Hisaab: the pay link as a QR the customer scans at the counter.
function ReminderNote({ text, link }: { text: string; link?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (link) QRCode.toString(link, { type: "svg", margin: 1, color: { dark: "#002E6E", light: "#FFFFFF" } }).then(setSvg, () => setSvg(""));
  }, [link]);
  return (
    <div className="mt-2 text-sm text-ink-2" role="status">
      <p>{text}</p>
      {link && (
        <>
          {svg && <div role="img" aria-label="Udhaar pay karne ka QR" className="kh-qr mt-2 max-w-[180px]" dangerouslySetInnerHTML={{ __html: svg }} />}
          <a href={link} className="mt-1 block truncate text-sky-text underline underline-offset-2">{link}</a>
        </>
      )}
    </div>
  );
}
