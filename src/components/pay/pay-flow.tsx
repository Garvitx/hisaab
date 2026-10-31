"use client";

import { useRef, useState } from "react";
import { BadgeCheck, Check, ChevronLeft, Delete, Landmark, Plus } from "lucide-react";
import { inr } from "@/components/format";
import "./pay.css";

type Paid = { txn_ref: string; amount: number; business_name: string; created_at: string };
type Props = { mid: string; sig: string; businessName: string; city: string };

const MAX = 5000;
const CHIPS = ["Judge", "Mentor", "Guest"];
const initials = (n: string) =>
  n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function PayFlow({ mid, sig, businessName, city }: Props) {
  const [step, setStep] = useState<"amount" | "pin" | "done">("amount");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const inFlight = useRef(false); // a ref, so a double tap can't slip in before the busy re-render

  const n = Number(amount || 0);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 30;
  const canPay = nameOk && n >= 1 && n <= MAX;

  const typeAmount = (key: string) => {
    if (key === "del") return setAmount((a) => a.slice(0, -1));
    const next = amount === "" && key === "0" ? "" : amount + key;
    if (Number(next) <= MAX) setAmount(next);
  };

  async function submit() {
    if (inFlight.current || pin.length !== 4) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // One idempotency key per PIN attempt: a replay of this attempt returns the same payment.
        body: JSON.stringify({ mid, sig, payer_name: name.trim(), amount: n, pin, idem: crypto.randomUUID() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPaid(body as Paid);
        setStep("done");
      } else {
        setError(body.error || "Payment failed. Try again.");
        setShake((x) => x + 1);
      }
    } catch {
      setError("No connection. Nothing was charged. Try again.");
      setShake((x) => x + 1);
    } finally {
      setPin("");
      inFlight.current = false;
      setBusy(false);
    }
  }

  const typePin = (key: string) => {
    if (busy) return;
    if (key === "ok") return void submit();
    if (key === "del") return setPin((x) => x.slice(0, -1));
    if (pin.length < 4) {
      setPin(pin + key);
      setError("");
    }
  };

  const toAmount = () => {
    setStep("amount");
    setPin("");
    setError("");
    setPaid(null);
  };

  const appBar = (onBack: () => void) => (
    <header className="flex items-center gap-3 bg-navy px-2 py-3 text-navy-ink">
      <button type="button" aria-label="Back" disabled={busy} onClick={onBack} className="pay-icon-btn">
        <ChevronLeft aria-hidden className="size-6" />
      </button>
      <span aria-hidden className="pay-avatar">{initials(businessName)}</span>
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight text-navy-ink">{businessName}</p>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-navy-ink-2">
          <BadgeCheck aria-hidden className="size-3.5 text-sky" /> Verified merchant, {city}
        </p>
      </div>
    </header>
  );

  if (step === "done" && paid) {
    const when = new Date(paid.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    return (
      <section className="flex flex-1 flex-col bg-paper-2">
        <div className="pay-success">
          <svg aria-hidden viewBox="0 0 52 52" className="pay-tick">
            <circle cx="26" cy="26" r="25" className="pay-tick-circle" />
            <path d="M15 27l7 7 15-16" className="pay-tick-path" />
          </svg>
          <p className="num mt-5 text-6xl font-semibold">{inr(paid.amount)}</p>
          <h1 className="mt-2 text-xl font-semibold">Paid to {paid.business_name}</h1>
        </div>
        <div className="-mt-6 px-4">
          <dl className="pay-details">
            <dt>Paid by</dt>
            <dd>{name.trim()}</dd>
            <dt>UPI ref</dt>
            <dd className="num">{paid.txn_ref}</dd>
            <dt>Time</dt>
            <dd>{when} IST</dd>
            {note && (
              <>
                <dt>Note</dt>
                <dd>{note}</dd>
              </>
            )}
            <dt>Type</dt>
            <dd>Demo transaction, no money moved</dd>
          </dl>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3 px-4 pb-6 pt-6">
          <button type="button" onClick={() => { setAmount(""); toAmount(); }} className={`pay-btn pay-ghost`}>
            Pay again
          </button>
          <button type="button" onClick={() => { setAmount(""); setName(""); setNote(null); toAmount(); }} className={`pay-btn pay-primary`}>
            Done
          </button>
        </div>
      </section>
    );
  }

  if (step === "pin")
    return (
      <section className="flex flex-1 flex-col bg-paper">
        {appBar(toAmount)}
        <p className="bg-navy-2 px-4 py-3 text-center text-navy-ink">
          Paying <span className="num font-semibold">{inr(n)}</span> to <span className="font-semibold">{businessName}</span>
        </p>
        <div className="flex-1 px-5 pt-8 text-center">
          <h1 className="pay-pin-title">ENTER 4-DIGIT UPI PIN</h1>
          <div
            key={shake}
            role="status"
            aria-label={`${pin.length} of 4 digits entered`}
            className={`mt-6 flex justify-center gap-5 ${shake ? "pay-shake" : ""}`}
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`pay-slot ${error ? "pay-slot-bad" : ""}`}>
                {i < pin.length && <span className="pay-slot-dot" />}
              </span>
            ))}
          </div>
          <p className="mt-3 min-h-6 text-sm text-bad" aria-live="assertive">
            {busy ? <span className="text-ink-3">Processing…</span> : error}
          </p>
          <p className="pay-pin-notice">
            <strong>Demo PIN: 1111.</strong> This is not your bank. Never type a real PIN.
          </p>
        </div>
        <Keypad onKey={typePin} disabled={busy} last={{ key: "ok", label: "Submit PIN", ok: pin.length === 4 }} />
      </section>
    );

  return (
    <section className="flex flex-1 flex-col bg-paper">
      {appBar(() => history.back())}
      <div className="flex-1 px-5 pb-4 pt-8">
        <p className="text-center text-sm text-ink-3">Enter amount</p>
        <p className="num mt-1 flex items-baseline justify-center text-ink" aria-live="polite" aria-label={`Amount ${inr(n)}`}>
          <span className="text-4xl text-ink-3">₹</span>
          <span className="ml-1 text-6xl font-semibold">{amount ? n.toLocaleString("en-IN") : <span className="text-ink-3">0</span>}</span>
          <span aria-hidden className="pay-caret" />
        </p>
        <p className="mt-1 text-center text-sm text-ink-3">₹1 to ₹5,000, whole rupees</p>

        <label htmlFor="payer" className="mt-7 block text-sm text-ink-2">
          Paying as
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => setName(c)} aria-pressed={name === c} className="pay-chip">
              {c}
            </button>
          ))}
        </div>
        <input
          id="payer"
          value={name}
          maxLength={30}
          autoComplete="off"
          placeholder="Or type your name"
          onChange={(e) => setName(e.target.value)}
          className="pay-input"
        />
        {note === null ? (
          <button type="button" onClick={() => setNote("")} className={`pay-note-pill mt-3`}>
            <Plus aria-hidden className="size-4" /> Add a note
          </button>
        ) : (
          <input
            aria-label="Note"
            value={note}
            maxLength={40}
            autoFocus
            placeholder="Note, only you see it"
            onChange={(e) => setNote(e.target.value)}
            className="pay-input"
          />
        )}
      </div>

      <div className="pay-dock">
        <div className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="pay-bank">
            <Landmark aria-hidden className="size-4" />
          </span>
          <span className="text-ink-3">Pay using</span>
          <span className="ml-auto font-semibold text-ink">UPI, demo@hisaab</span>
        </div>
        <div className="px-4 pb-2">
          <button type="button" disabled={!canPay} onClick={() => setStep("pin")} className={`pay-btn pay-primary`}>
            {canPay ? `Pay ${inr(n)}` : nameOk ? "Enter an amount" : "Pick a name to pay"}
          </button>
        </div>
        <Keypad onKey={typeAmount} />
      </div>
    </section>
  );
}

function Keypad({ onKey, disabled, last }: { onKey: (k: string) => void; disabled?: boolean; last?: { key: string; label: string; ok: boolean } }) {
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const key = (k: string, label: string, body: React.ReactNode, extra = "", off = false) => (
    <button key={k} type="button" disabled={disabled || off} onClick={() => onKey(k)} aria-label={label} className={`pay-key ${extra} num`}>
      {body}
    </button>
  );
  const del = key("del", "Delete", <Delete aria-hidden className="mx-auto size-6" />);
  return (
    <div className="pay-pad">
      {digits.map((d) => key(d, d, d))}
      {last ? del : <span />}
      {key("0", "0", "0")}
      {last ? key(last.key, last.label, <Check aria-hidden className="mx-auto size-7" strokeWidth={3} />, "pay-key-ok", !last.ok) : del}
    </div>
  );
}
