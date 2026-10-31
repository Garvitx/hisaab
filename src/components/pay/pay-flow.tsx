"use client";

import { useRef, useState } from "react";
import { Check, Delete, Lock } from "lucide-react";
import { inr } from "@/components/format";
import s from "./pay.module.css";

type Paid = { txn_ref: string; amount: number; business_name: string; created_at: string };
type Props = { mid: string; sig: string; businessName: string; city: string };

const MAX = 5000;
const CHIPS = ["Judge", "Mentor", "Guest"];

export function PayFlow({ mid, sig, businessName, city }: Props) {
  const [step, setStep] = useState<"amount" | "pin" | "done">("amount");
  const [name, setName] = useState("");
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

  async function submit(p: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // One idempotency key per PIN attempt: a replay of this attempt returns the same payment.
        body: JSON.stringify({ mid, sig, payer_name: name.trim(), amount: n, pin: p, idem: crypto.randomUUID() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPaid(body as Paid);
        setStep("done");
      } else {
        setError(body.error || "Payment failed. Try again.");
        setShake((x) => x + 1);
        setPin("");
      }
    } catch {
      setError("No connection. Nothing was charged. Try again.");
      setShake((x) => x + 1);
      setPin("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const typePin = (key: string) => {
    if (busy) return;
    if (key === "del") return setPin((x) => x.slice(0, -1));
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    setError("");
    if (next.length === 4) void submit(next);
  };

  const reset = () => {
    setStep("amount");
    setAmount("");
    setPin("");
    setError("");
    setPaid(null);
  };

  const header = (
    <header className="bg-navy px-5 pb-5 pt-4 text-navy-ink">
      <p className="text-sm text-navy-ink-2">Paying</p>
      <h1 className="mt-0.5 text-2xl text-navy-ink">{businessName}</h1>
      <p className="text-sm text-navy-ink-2">{city}</p>
    </header>
  );

  if (step === "done" && paid)
    return (
      <section className="overflow-hidden rounded-[var(--radius-card)] bg-paper text-center shadow-[var(--shadow-card)]">
        <div className="px-5 pb-6 pt-8">
          <div className={`mx-auto flex size-20 items-center justify-center rounded-full bg-good text-paper ${s.pop}`}>
            <Check aria-hidden className="size-11" strokeWidth={3} />
          </div>
          <p className="num mt-5 text-5xl font-semibold text-ink">{inr(paid.amount)}</p>
          <h1 className="mt-2 text-xl text-ink">Paid to {paid.business_name}</h1>
          <dl className="mx-auto mt-6 grid max-w-[280px] grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-left text-sm">
            <dt className="text-ink-3">Txn ref</dt>
            <dd className="num text-right text-ink">{paid.txn_ref}</dd>
            <dt className="text-ink-3">Time</dt>
            <dd className="text-right text-ink">
              {new Date(paid.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
            </dd>
            <dt className="text-ink-3">From</dt>
            <dd className="text-right text-ink">{name.trim()}</dd>
          </dl>
        </div>
        <div className="border-t border-rule p-4">
          <button type="button" onClick={reset} className={`${s.btn} ${s.ghost}`}>
            Pay again
          </button>
        </div>
      </section>
    );

  if (step === "pin")
    return (
      <section className="overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-card)]">
        {header}
        <div className="px-5 pt-5 text-center">
          <p className="text-ink-2">
            Paying <span className="num font-semibold text-ink">{inr(n)}</span>
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-sky-wash px-3 py-1 text-sm font-semibold text-sky-ink">
            <Lock aria-hidden className="size-3.5" /> Demo PIN: 1111
          </p>
          <div key={shake} className={`mt-5 flex justify-center gap-4 ${shake ? s.shake : ""}`} aria-label={`${pin.length} of 4 digits entered`} role="status">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`${s.dot} ${i < pin.length ? s.dotOn : ""} ${error ? s.dotBad : ""}`} />
            ))}
          </div>
          <p className="mt-3 min-h-6 text-sm text-bad" aria-live="assertive">
            {busy ? <span className="text-ink-3">Processing…</span> : error}
          </p>
        </div>
        <Keypad onKey={typePin} disabled={busy} />
        <div className="px-4 pb-4">
          <button type="button" onClick={() => { setStep("amount"); setPin(""); setError(""); }} disabled={busy} className={`${s.btn} ${s.ghost}`}>
            Back
          </button>
        </div>
      </section>
    );

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-card)]">
      {header}
      <div className="px-5 pt-5">
        <label htmlFor="payer" className="text-sm text-ink-2">
          Your name
        </label>
        <input
          id="payer"
          value={name}
          maxLength={30}
          autoComplete="off"
          placeholder="Who is paying?"
          onChange={(e) => setName(e.target.value)}
          className={s.input}
        />
        <div className="mt-2 flex gap-2">
          {CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => setName(c)} aria-pressed={name === c} className={s.chip}>
              {c}
            </button>
          ))}
        </div>
        <p className="mt-6 text-sm text-ink-2">Amount</p>
        <p className="num mt-1 text-center text-5xl font-semibold text-ink" aria-live="polite">
          <span className="text-ink-3">₹</span>
          {amount ? Number(amount).toLocaleString("en-IN") : "0"}
        </p>
        <p className="mt-1 text-center text-sm text-ink-3">Whole rupees, ₹1 to ₹5,000</p>
      </div>
      <Keypad onKey={typeAmount} />
      <div className="px-4 pb-4">
        <button type="button" disabled={!canPay} onClick={() => setStep("pin")} className={`${s.btn} ${s.primary}`}>
          {canPay ? `Pay ${inr(n)}` : nameOk ? "Enter an amount" : "Enter your name"}
        </button>
      </div>
    </section>
  );
}

function Keypad({ onKey, disabled }: { onKey: (k: string) => void; disabled?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-1 px-4 py-4">
      {keys.map((key, i) =>
        key === "" ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onKey(key)}
            aria-label={key === "del" ? "Delete" : key}
            className={`${s.key} num`}
          >
            {key === "del" ? <Delete aria-hidden className="mx-auto size-6" /> : key}
          </button>
        ),
      )}
    </div>
  );
}
