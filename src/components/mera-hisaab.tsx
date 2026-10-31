"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import type { MeraHisaab as D } from "@/app/api/ui/m/[mid]/route";
import { announce, usePoll } from "@/components/live";
import { ago, day, inr, time, type Json } from "@/components/format";
import { Empty, Failed, Panel, Skeleton } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type M = Json<D>;
type S = M["settlements"][number];

function Settlement({ s, open }: { s: S; open?: boolean }) {
  const summary = (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-semibold text-ink">{day(s.date)}</span>
      <span className="text-sm text-ink-3">
        {s.deductions.length ? `${s.deductions.length} katauti` : "koi katauti nahi"}
      </span>
      <span className="num ml-auto text-lg font-semibold">{inr(s.net)}</span>
    </div>
  );
  const body = (
    <dl className="mt-2 flex flex-col gap-1.5 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-ink-2">Customers se aaye</dt>
        <dd className="num">{inr(s.gross)}</dd>
      </div>
      {s.deductions.map((d) => (
        <div key={d.id} className="flex justify-between gap-4">
          <dt className="text-ink-2">{d.text}</dt>
          <dd className="num shrink-0 text-bad">-{inr(d.amount)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-rule pt-1.5 font-semibold">
        <dt>Bank mein aaya</dt>
        <dd className="num">{inr(s.net)}</dd>
      </div>
    </dl>
  );
  if (open) return <div className="px-4 py-3">{summary}{body}</div>;
  return (
    <details className="group px-4 py-3">
      <summary className="cursor-pointer list-none rounded">{summary}</summary>
      {body}
    </details>
  );
}

function Chat({ mid, messages }: { mid: string; messages: M["messages"] }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<{ id: number; dir: "IN" | "OUT"; text: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length, local.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setLocal((l) => [...l, { id: Date.now(), dir: "IN", text: t }]);
    setText("");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchant_id: mid, text: t }),
      });
      const reply =
        r.status === 404
          ? "Web chat abhi chalu nahi hua. Kripya WhatsApp par message karein."
          : r.ok
            ? ((await r.json().catch(() => null))?.reply ?? "Jawab nahi mila, dobara koshish karein.")
            : "Kuch gadbad hui, thodi der baad koshish karein.";
      setLocal((l) => [...l, { id: Date.now() + 1, dir: "OUT", text: reply }]);
    } catch {
      setLocal((l) => [...l, { id: Date.now() + 1, dir: "OUT", text: "Network nahi mila, dobara koshish karein." }]);
    } finally {
      setBusy(false);
    }
  };

  const all = [
    ...messages.map((m) => ({ id: m.id, dir: m.direction, voice: m.type === "VOICE", text: m.text ?? m.transcript ?? "", transcript: m.type === "VOICE" ? m.transcript : null, at: m.created_at as string | null })),
    ...local.map((m) => ({ id: String(m.id), dir: m.dir, voice: false, text: m.text, transcript: null, at: null })),
  ];

  return (
    <Panel title="WhatsApp par baat" aside={<span className="text-sm text-ink-3">Hisaab assistant</span>}>
      <div ref={box} className="flex max-h-[28rem] min-h-48 flex-col gap-2 overflow-y-auto bg-paper-2 px-3 py-3">
        {all.length ? (
          all.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-base shadow-(--shadow-card)",
                m.dir === "IN" ? "self-end rounded-br-sm bg-wa text-ink" : "self-start rounded-bl-sm bg-paper text-ink",
              )}
            >
              {m.voice && (
                <span className="mb-0.5 flex items-center gap-1 text-sm text-ink-3">
                  <Mic className="size-3.5" aria-hidden /> Voice note
                </span>
              )}
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {m.transcript && m.transcript !== m.text && <p className="mt-1 text-sm text-ink-3">{m.transcript}</p>}
              {m.at && <p className="num mt-0.5 text-right text-xs text-ink-3">{time(m.at)}</p>}
            </div>
          ))
        ) : (
          <p className="m-auto max-w-[36ch] text-center text-ink-3">
            Abhi koi baat nahi hui. Koi bhi sawaal poochiye, jaise &ldquo;Kal kitna aayega?&rdquo;
          </p>
        )}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-rule p-3">
        <label htmlFor="chat-text" className="sr-only">Apna sawaal likhiye</label>
        <input
          id="chat-text"
          name="text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Sawaal likhiye…"
          className="h-10 min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 text-base"
        />
        <Button type="submit" size="lg" className="h-10 px-4" disabled={busy || !text.trim()}>
          {busy ? "Bhej rahe…" : "Bhejiye"}
        </Button>
      </form>
    </Panel>
  );
}

export function MeraHisaab({ mid, compact }: { mid: string; compact?: boolean }) {
  const { data: m, error } = usePoll<M>(`/api/ui/m/${encodeURIComponent(mid)}`);

  // A new credit lands: the Soundbox-style announcement (voice agent's TTS), once per credit.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!m) return;
    const ids = m.credits.map((c) => c.id);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    for (const c of m.credits) {
      if (seen.current.has(c.id)) continue;
      seen.current.add(c.id);
      if (c.undone) continue;
      announce(`Paytm par ₹${c.amount} refund prapt hue`);
      toast.success(`${inr(c.amount)} wapas aaye`, { description: c.reason });
    }
  }, [m]);

  if (!m)
    return error === "404" ? (
      <Panel><Empty title={`Merchant ${mid} nahi mila`}>MID check kijiye.</Empty></Panel>
    ) : error ? (
      <Panel><Failed what="Mera Hisaab" error={error} /></Panel>
    ) : (
      <Panel><Skeleton rows={6} /></Panel>
    );

  const [latest, ...rest] = m.settlements;
  const credited = m.credits.filter((c) => !c.undone).reduce((a, c) => a + c.amount, 0);

  const statement = (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel>
        <div className="px-4 pt-4">
          <p className="text-ink-3">Namaste {m.merchant.owner_name.split(" ")[0]} ji</p>
          <h1 className={compact ? "text-xl" : "text-2xl"}>Mera Hisaab</h1>
          <p className="text-sm text-ink-3">{m.merchant.business_name}, {m.merchant.city}</p>
        </div>
        {latest ? (
          <>
            <p className="px-4 pt-3 text-sm text-ink-2">Sabse naya settlement</p>
            <Settlement s={latest} open />
          </>
        ) : (
          <Empty title="Abhi koi settlement nahi">Pehla settlement aate hi yahan dikhega.</Empty>
        )}
      </Panel>

      {m.credits.length > 0 && (
        <Panel title="Wapas mila" aside={<span className="num font-semibold text-good">{inr(credited)}</span>}>
          <ul className="divide-y divide-rule">
            {m.credits.map((c) => (
              <li key={c.id} className="row-in flex items-baseline justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0">
                  <span className={cn("block text-ink", c.undone && "line-through text-ink-3")}>{c.reason}</span>
                  <span className="text-sm text-ink-3">{c.undone ? "Ye credit wapas le liya gaya" : ago(c.created_at)}</span>
                </span>
                <span className={cn("num shrink-0 font-semibold", c.undone ? "text-ink-3 line-through" : "text-good")}>+{inr(c.amount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Aage dhyan dijiye">
        {m.warnings.length ? (
          <ul className="divide-y divide-rule">
            {m.warnings.map((w) => (
              <li key={w.id} className="bg-warn-wash px-4 py-2.5 text-ink">{w.text}</li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-ink-2">Koi nayi katauti nahi aane wali. Sab theek hai.</p>
        )}
      </Panel>

      {!compact && rest.length > 0 && (
        <Panel title="Pichhle settlements">
          <div className="divide-y divide-rule">
            {rest.map((s) => (
              <Settlement key={s.id} s={s} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );

  return compact ? (
    <div className="flex flex-col gap-4">
      {statement}
      <Chat mid={mid} messages={m.messages} />
    </div>
  ) : (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {statement}
      <div className="min-w-0 lg:sticky lg:top-18 lg:self-start">
        <Chat mid={mid} messages={m.messages} />
      </div>
    </div>
  );
}
