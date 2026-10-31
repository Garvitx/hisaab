"use client";

import { useState, useSyncExternalStore } from "react";
import { Nfc } from "lucide-react";
import "./khata.css";

// Web NFC writes a URL record to a blank NTAG sticker. Only Chrome on Android has it; everywhere
// else we say so instead of showing a button that can't work.
const noop = () => () => {};
type Ndef = { write: (m: { records: { recordType: string; data: string }[] }) => Promise<void> };

export function NfcWrite({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "waiting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  // Known only in the browser; deciding it during render would mismatch the server HTML.
  const supported = useSyncExternalStore(noop, () => "NDEFReader" in window, () => null);
  if (supported === null) return null;
  if (!supported)
    return <p className="mt-2 text-sm text-ink-3">Sticker likhne ke liye ye page Android phone par Chrome mein kholiye. Ya QR kisi NFC app se sticker par likhiye.</p>;
  const write = async () => {
    setState("waiting");
    setMsg("Ab phone ko sticker se lagaiye…");
    try {
      const W = (window as unknown as { NDEFReader: new () => Ndef }).NDEFReader;
      await new W().write({ records: [{ recordType: "url", data: url }] });
      setState("done");
      setMsg("Sticker taiyaar hai.");
    } catch (e) {
      setState("error");
      setMsg((e as Error)?.name === "NotAllowedError" ? "NFC ki permission nahi mili." : "Sticker par nahi likh paaye. Dobara try kijiye.");
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" className="kh-btn kh-primary" disabled={state === "waiting"} onClick={write}>
        <Nfc aria-hidden className="size-4" /> Write to NFC sticker
      </button>
      {msg && <span role="status" className={state === "error" ? "text-bad" : "text-ink-2"}>{msg}</span>}
    </div>
  );
}
