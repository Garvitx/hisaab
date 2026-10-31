"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Volume2 } from "lucide-react";
import type { MeraHisaab as D } from "@/app/api/ui/m/[mid]/route";
import { announce, announcePayments, setSound, usePoll, useSound } from "@/components/live";
import { ago, day, inr, time, type Json } from "@/components/format";
import { Empty, Failed, Panel, Skeleton } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { MerchantSwitcher } from "@/components/merchant-switcher";
import { CollectPayment } from "@/components/collect-payment";
import { DeviceList } from "@/components/device-toggle";
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

// A WhatsApp-style voice bubble: play/pause, progress, duration once known (preload="none" keeps it cheap).
function VoiceNote({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  return (
    <div className="flex min-w-52 items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-navy text-navy-ink transition-colors duration-(--dur-micro) hover:bg-navy-2"
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="h-1 overflow-hidden rounded-full bg-navy-ink-2">
          <div
            className="h-full origin-left rounded-full bg-sky"
            style={{ transform: `scaleX(${dur ? Math.min(1, pos / dur) : 0})` }}
          />
        </div>
        <span className="num flex items-center gap-1 text-xs text-ink-3">
          <Mic className="size-3" aria-hidden />
          {dur ? `${fmt(playing || pos ? pos : dur)}${playing || pos ? ` / ${fmt(dur)}` : ""}` : "Voice note"}
        </span>
      </div>
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
      />
    </div>
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

  type B = { id: string; dir: string; merged?: boolean; media: string | null; text: string; transcript: string | null; at: string | null };
  // We send an OUT voice note and the same text as a second message: show them as one bubble.
  const all: B[] = [];
  for (const m of messages) {
    const text = (m.text ?? "").trim();
    const prev = all[all.length - 1];
    if (m.direction === "OUT" && m.type === "TEXT" && prev?.dir === "OUT" && prev.media && prev.text === text) {
      prev.merged = true;
      continue;
    }
    const voice = m.type === "VOICE" && !!m.media_url;
    all.push({
      id: m.id,
      dir: m.direction,
      media: voice ? m.media_url : null,
      // IN voice: the merchant's words are the transcript; OUT voice: Hisaab's reply is the text.
      text: voice ? (m.direction === "IN" ? (m.transcript ?? m.text ?? "") : (m.text ?? m.transcript ?? "")).trim() : (m.text ?? m.transcript ?? ""),
      transcript: !voice && m.type === "VOICE" ? m.transcript : null,
      at: m.created_at,
    });
  }
  for (const m of local) all.push({ id: String(m.id), dir: m.dir, media: null, text: m.text, transcript: null, at: null });

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
              {m.media ? (
                <>
                  <VoiceNote src={m.media} />
                  {m.text &&
                    (m.merged ? (
                      <p className="mt-2 whitespace-pre-wrap break-words">{m.text}</p>
                    ) : (
                      <details className="mt-1.5 text-sm">
                        <summary className="w-fit cursor-pointer rounded text-ink-3">Transcript</summary>
                        <p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{m.text}</p>
                      </details>
                    ))}
                </>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.transcript && m.transcript !== m.text && <p className="mt-1 text-sm text-ink-3">{m.transcript}</p>}
                </>
              )}
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

export function MeraHisaab({
  mid,
  compact,
  qr,
  switchMode = "m",
}: {
  mid: string;
  compact?: boolean;
  qr?: React.ReactNode;
  switchMode?: "m" | "demo";
}) {
  const { data: m, error } = usePoll<M>(`/api/ui/m/${encodeURIComponent(mid)}`);

  // New payments and credits since the page loaded: toast each, one announcement per poll.
  // A payment wins the voice when both land together; the credit still gets its toast.
  // "New" = created after this page started listening (and within 2 min) AND not seen before.
  // An id check alone re-announced old payments whenever the merchant switched or rows were
  // deleted (older payments slid into the visible window and looked new).
  const seen = useRef<Set<string> | null>(null);
  const since = useRef(0);
  useEffect(() => {
    seen.current = null; // a different merchant starts from a clean slate
  }, [mid]);
  useEffect(() => {
    if (!m) return;
    const ids = [...m.payments.map((p) => p.id), ...m.credits.map((c) => c.id)];
    if (!seen.current) {
      seen.current = new Set(ids);
      since.current = Date.now();
      return;
    }
    const fresh = (t: string) => {
      const at = Date.parse(t);
      return at >= since.current - 5_000 && Date.now() - at < 120_000;
    };
    const s = seen.current;
    const pays = m.payments.filter((p) => !s.has(p.id) && fresh(p.created_at)).reverse();
    const creds = m.credits.filter((c) => !s.has(c.id) && fresh(c.created_at));
    ids.forEach((id) => s.add(id));
    const ok = pays.filter((p) => p.status === "SUCCESS");
    // At most 3 toasts per poll: past that, two names and one "+N more" summary.
    const named = ok.length > 3 ? ok.slice(0, 2) : ok;
    named.forEach((p) => toast.success(`${p.payer} paid ${inr(p.amount)}`));
    if (ok.length > 3) {
      const rest = ok.slice(2);
      toast.success(`+${rest.length} more payments`, { description: `${inr(rest.reduce((a, p) => a + p.amount, 0))} in total` });
    }
    announcePayments(ok.map((p) => p.amount));
    const spoke = ok.length > 0;
    for (const c of creds) {
      if (c.undone) continue;
      toast.success(`${inr(c.amount)} wapas aaye`, { description: c.reason });
      if (!spoke) announce(`Paytm par ₹${c.amount} refund prapt hue`);
    }
  }, [m, mid]);
  const sound = useSound();

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

  const feed = (
    <>
      <Panel title="Naye payments" aside={<span className="text-sm text-ink-3">Live</span>}>
        {m.payments.length ? (
          <ul className="divide-y divide-rule" aria-live="polite">
            {m.payments.slice(0, compact ? 6 : 30).map((p) => (
              <li key={p.id} className="row-in flex items-baseline justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{p.payer}</span>
                  <span className="num text-sm text-ink-3">
                    {time(p.created_at)} IST{p.status !== "SUCCESS" && `, ${p.status === "PENDING" ? "pending" : p.status === "FAILED" ? "failed" : "refunded"}`}
                  </span>
                </span>
                <span className={cn("num shrink-0 text-lg font-semibold", p.status === "SUCCESS" ? "text-good" : "text-ink-3")}>
                  +{inr(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Abhi koi payment nahi">Naya payment aate hi yahan dikhega aur Soundbox bolega.</Empty>
        )}
      </Panel>

    </>
  );

  const statement = (
    <div className="flex min-w-0 flex-col gap-4">
      <MerchantSwitcher mid={mid} mode={switchMode} />
      {qr && (
        <CollectPayment businessName={m.merchant.business_name} city={m.merchant.city} payments={m.payments}>
          {qr}
        </CollectPayment>
      )}
      {!sound && (
        <button
          type="button"
          onClick={() => setSound(true)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-(--radius-card) border border-sky bg-sky-wash px-4 font-semibold text-sky-ink transition-colors duration-(--dur-micro) hover:bg-sky"
        >
          <Volume2 className="size-4" aria-hidden />
          Enable payment sound
        </button>
      )}
      {compact && feed}
      <Panel>
        <div className="px-4 pt-4">
          <p className="text-ink-3">Namaste {m.merchant.owner_name.split(" ")[0]} ji</p>
          <h1 className={compact ? "text-xl" : "text-2xl"}>Mera Hisaab</h1>
          <p className="text-sm text-ink-3">{m.merchant.business_name}, {m.merchant.city}</p>
          <div className="mt-4 rounded-lg bg-navy px-4 py-3 text-navy-ink">
            <p className="text-sm text-navy-ink-2">Aaj ab tak</p>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="num text-3xl font-semibold">{inr(m.today.total)}</span>
              <span className="num text-navy-ink-2">{m.today.count} payment</span>
            </p>
            {(m.today.pending > 0 || m.today.failed > 0) && (
              <p className="num mt-0.5 text-sm text-navy-ink-2">
                {[m.today.pending && `${m.today.pending} pending`, m.today.failed && `${m.today.failed} failed`].filter(Boolean).join(", ")}
              </p>
            )}
            <p className="mt-1 text-sm text-navy-ink-2">Kal ({day(m.today.settles_on)}) ko settle hoga</p>
          </div>
          {m.devices.length > 0 && (
            <div className="mt-3">
              <DeviceList devices={m.devices} />
            </div>
          )}
        </div>
        {latest ? (
          <>
            <div className="border-t border-rule px-4 pt-3">
              <h2 className="text-base">Sabse naya settlement (bank mein bheja)</h2>
              <p className="text-sm text-ink-3">{day(new Date(new Date(latest.date).getTime() - 86_400_000))} ke payments ka</p>
            </div>
            <Settlement s={latest} open />
          </>
        ) : (
          <Empty title="Abhi koi settlement nahi">Pehla settlement aate hi yahan dikhega.</Empty>
        )}
      </Panel>

      {!compact && feed}
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
