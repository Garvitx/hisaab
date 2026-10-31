"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Mic, Pencil, Trash2, Volume2 } from "lucide-react";
import type { KhataView } from "@/app/api/khata/[mid]/route";
import { inr, type Json } from "@/components/format";
import "./khata.css";

type V = Json<KhataView>;
type Draft = V["drafts"][number];
type Phase = "idle" | "listening" | "thinking" | "saved";

// The NFC sticker's page: hold the mic, speak, check the drafts, tap Confirm. Nothing is saved for
// real until a Confirm tap; the voice line after saving is played from that tap (autoplay rules).
export function TapPad({ mid, sig, businessName }: { mid: string; sig: string; businessName: string }) {
  const [v, setV] = useState<V | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [heard, setHeard] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; t0: number; timer: number } | null>(null);
  const busy = phase === "thinking";

  const drafts = v?.drafts ?? [];

  // Fetched on load, after every action, and every 15 s (a UPI payment moves today's total).
  // No 1.5 s poll: a stale poll landing after a tap would bring confirmed drafts back for a moment.
  const refresh = async () => {
    const r = await fetch(`/api/khata/${encodeURIComponent(mid)}`, { cache: "no-store" }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as V) : null;
    if (j) setV(j);
    return j;
  };
  useEffect(() => {
    // setV runs after the fetch resolves, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mid]);

  async function submit(body: FormData) {
    setPhase("thinking");
    setError("");
    body.append("mid", mid);
    body.append("sig", sig);
    try {
      const r = await fetch("/api/khata/voice", { method: "POST", body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Kuch gadbad hui, dobara try karein.");
      setHeard(j.transcript ?? "");
      await refresh();
      if (!j.drafts.length) setError("Isme koi entry nahi mili. Jaise boliye: 'paanch sau cash mile'.");
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  async function start() {
    if (rec.current || busy) return;
    setError("");
    setSaid(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: (mr.mimeType || "audio/webm").split(";")[0] });
        if (blob.size < 1500) return setPhase("idle"); // a slip of the thumb, not a sentence
        const f = new FormData();
        f.append("audio", blob, `khata.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
        void submit(f);
      };
      mr.start();
      rec.current = { mr, chunks, t0: Date.now(), timer: window.setTimeout(stop, 30_000) };
      setPhase("listening");
    } catch {
      setError("Mic ki permission nahi mili. Neeche likh kar bhi daal sakte hain.");
    }
  }
  function stop() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearTimeout(r.timer);
    if (r.mr.state !== "inactive") r.mr.stop();
  }
  // Hold to talk; a quick tap instead starts it and the next tap stops it.
  const down = () => (rec.current ? stop() : void start());
  const up = () => rec.current && Date.now() - rec.current.t0 > 500 && stop();

  async function op(body: Record<string, unknown>) {
    const r = await fetch("/api/khata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mid, sig, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Nahi ho paaya.");
    return j;
  }

  async function confirmIds(ids?: string[]) {
    setError("");
    try {
      await op({ op: "confirm", ids });
      const fresh = await refresh();
      setPhase("saved");
      const line = `Likh liya. Aaj ki kamai ${fresh?.today.kamai ?? ""} rupaye.`;
      setSaid(line);
      speak(line);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function edit(d: Draft, ch: Record<string, unknown>) {
    setError("");
    try {
      await op({ op: "edit", id: d.id, ...ch });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const speak = (line: string) => void new Audio(`/api/announce?text=${encodeURIComponent(line)}`).play().catch(() => {});

  const t = v?.today;
  return (
    <main className="kh-app mx-auto flex w-full max-w-[430px] flex-1 flex-col gap-4 px-4 pb-10 pt-5">
      <header className="text-center">
        <h1 className="text-2xl text-ink [overflow-wrap:break-word]">{businessName}</h1>
        <p className="text-sm text-ink-3">Khata</p>
      </header>

      <section aria-live="polite" className="rounded-(--radius-card) bg-navy px-4 py-3 text-center text-navy-ink">
        <p className="text-sm text-navy-ink-2">Aaj ki kamai</p>
        <p className="num text-4xl font-semibold">{t ? inr(t.kamai) : "…"}</p>
        {t && (
          <p className="num mt-1 text-sm text-navy-ink-2">
            UPI {inr(t.upi.total)} (Paytm se verified) + Cash {inr(t.cash.total)} (aapne bataya)
          </p>
        )}
      </section>

      <div className="py-4 text-center">
        <button
          type="button"
          className="kh-mic"
          data-state={phase}
          disabled={busy}
          aria-pressed={phase === "listening"}
          aria-label={phase === "listening" ? "Sun raha hoon, chhodiye ya dobara dabaiye" : "Bolkar likhiye, dabakar rakhiye"}
          onPointerDown={(e) => (e.preventDefault(), down())}
          onPointerUp={up}
          onPointerCancel={stop}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), down())}
        >
          <span className="grid justify-items-center gap-2">
            <Mic aria-hidden className="size-14" strokeWidth={2.2} />
            {phase === "listening" ? "Sun raha hoon…" : busy ? "Likh raha hoon…" : "Bolkar likhiye"}
          </span>
        </button>
        <p className="mt-4 text-sm text-ink-3">Dabakar boliye: &ldquo;paanch sau cash mile, Gupta ko teen sau udhaar diya&rdquo;</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          const f = new FormData();
          f.append("text", text.trim());
          setText("");
          void submit(f);
        }}
      >
        <label htmlFor="kh-text" className="sr-only">Ya likhiye</label>
        <input id="kh-text" className="kh-input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ya likhiye: aaj 3400 cash aaya" autoComplete="off" />
        <button type="submit" className="kh-btn kh-ghost" disabled={busy || !text.trim()}>Likhiye</button>
      </form>

      {error && <p role="alert" className="rounded-lg bg-bad-wash px-3 py-2 text-bad">{error}</p>}
      {heard && drafts.length > 0 && <p className="text-sm text-ink-3">Suna: &ldquo;{heard}&rdquo;</p>}

      {phase === "saved" && !drafts.length && (
        <section className="flex items-center gap-3 rounded-(--radius-card) bg-paper px-4 py-3 shadow-(--shadow-card)">
          <svg aria-hidden viewBox="0 0 52 52" className="kh-tick shrink-0">
            <circle cx="26" cy="26" r="25" />
            <path d="M15 27l7 7 15-16" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">Likh liya</p>
            <p className="num text-ink-2">Aaj ki kamai {inr(t?.kamai)}</p>
          </div>
          {said && (
            <button type="button" className="kh-btn kh-ghost" onClick={() => speak(said)} aria-label="Suniye">
              <Volume2 aria-hidden className="size-4" />
            </button>
          )}
        </section>
      )}

      {drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg text-ink">Sahi hai? Check karke pakka kijiye</h2>
          <ul className="flex flex-col gap-3">
            {drafts.map((d) => (
              <li key={d.id} className="rounded-(--radius-card) bg-paper px-4 py-3 shadow-(--shadow-card)">
                <p className="text-lg font-semibold text-ink [overflow-wrap:break-word]">{d.label.replace(/Rs (\d[\d,]*)/, (_, n) => `₹${n}`)}</p>
                {d.choices && (
                  <div className="mt-2">
                    <p className="text-sm text-ink-2">{d.counterparty.name} kaun?</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {d.choices.map((c) => (
                        <button key={c.name} type="button" className="kh-chip" onClick={() => edit(d, { choice: c })}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                )}
                {editing === d.id ? (
                  <form className="mt-2 flex gap-2" onSubmit={(e) => (e.preventDefault(), edit(d, { amount: Number(amount) }))}>
                    <label htmlFor={`amt-${d.id}`} className="sr-only">Sahi amount</label>
                    <input id={`amt-${d.id}`} className="kh-input num w-28" inputMode="numeric" pattern="[0-9]*" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 8))} />
                    <button type="submit" className="kh-btn kh-primary" disabled={!Number(amount)}>Theek</button>
                    <button type="button" className="kh-btn kh-ghost" onClick={() => setEditing(null)}>Rehne do</button>
                  </form>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="kh-btn kh-primary" disabled={!!d.choices} onClick={() => confirmIds([d.id])}>
                      <Check aria-hidden className="size-4" /> Sahi
                    </button>
                    <button type="button" className="kh-btn kh-ghost" onClick={() => (setEditing(d.id), setAmount(String(d.amount)))}>
                      <Pencil aria-hidden className="size-4" /> Amount badlo
                    </button>
                    <button type="button" className="kh-btn kh-danger" onClick={() => edit(d, { delete: true })}>
                      <Trash2 aria-hidden className="size-4" /> Hatao
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="kh-btn kh-primary kh-wide" disabled={drafts.every((d) => d.choices)} onClick={() => confirmIds(drafts.filter((d) => !d.choices).map((d) => d.id))}>
            Sab sahi hai
          </button>
        </section>
      )}

      {t && (
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-(--radius-card) bg-paper px-4 py-3 text-sm shadow-(--shadow-card)">
          <dt className="text-ink-2">Kharcha (aapne bataya)</dt>
          <dd className="text-bad">-{inr(t.expenses.total)}</dd>
          <dt className="text-ink-2">Udhaar diya aaj</dt>
          <dd>{inr(t.udhaar.given)}</dd>
          <dt className="text-ink-2">Kul lene hain</dt>
          <dd>{inr(t.udhaar.outstanding_lene)}</dd>
          <dt className="text-ink-2">Kul dene hain</dt>
          <dd>{inr(t.udhaar.outstanding_dene)}</dd>
        </dl>
      )}
    </main>
  );
}
