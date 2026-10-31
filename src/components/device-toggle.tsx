"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { announce } from "@/components/live";

const OFFLINE_MS = 30 * 60 * 1000;
type Ev = { type: string; at: string };
export type Dev = { id: string; serial: string; model: string; last_seen_at: string; events: Ev[] };

// Where the device physically is, from logistics events.
export function deviceState(events: Ev[]): "in_shop" | "returned" | "never_delivered" {
  const t = (e: Ev) => new Date(e.at).getTime();
  const delivered = events.filter((e) => e.type === "DELIVERED").map(t);
  const back = events.filter((e) => e.type === "PICKED_UP" || e.type === "RECEIVED_AT_WAREHOUSE").map(t);
  const lastDelivered = delivered.length ? Math.max(...delivered) : null;
  if (back.some((b) => lastDelivered == null || b >= lastDelivered)) return "returned";
  return lastDelivered == null ? "never_delivered" : "in_shop";
}

export const deviceName = (d: { model: string; serial: string }) => `${d.model === "EDC" ? "EDC" : "Soundbox"} …${d.serial.slice(-4)}`;

export const isOnline = (lastSeen: string) => Date.now() - new Date(lastSeen).getTime() <= OFFLINE_MS;

// Flips a device via POST /api/devices/<id>/status. Shows the server's answer until the next poll catches up.
export function DeviceToggle({ id, model, name: label, lastSeen, compact }: { id: string; model: string; name?: string; lastSeen: string; compact?: boolean }) {
  const [seen, setSeen] = useState<{ from: string; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A newer poll value wins over our local echo.
  const at = seen && seen.from === lastSeen ? seen.at : lastSeen;
  const on = isOnline(at);
  const name = label ?? (model === "EDC" ? "EDC machine" : "Soundbox");

  // A change we didn't make here is remote (WhatsApp "restart karo", ops dashboard): show it and,
  // when it comes back, let the Soundbox announce itself.
  const prev = useRef(on);
  const mine = useRef(false);
  useEffect(() => {
    if (prev.current === on) return;
    if (!mine.current) {
      if (on) {
        toast.success(`${name} wapas online hai`, { description: "Remotely restart hua" });
        announce(`${name} wapas online hai`);
      } else toast(`${name} remotely band kiya gaya`, { description: "Restart ho raha hai…" });
    }
    mine.current = false;
    prev.current = on;
  }, [on, name]);

  const restart = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/devices/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      toast(`${name} remotely restart ho raha hai…`);
    } catch {
      toast.error(`${name} restart nahi ho paaya`);
    } finally {
      setBusy(false);
    }
  };

  const flip = async () => {
    mine.current = true;
    setBusy(true);
    try {
      const r = await fetch(`/api/devices/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ online: !on }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { online: boolean; last_seen_at: string };
      setSeen({ from: lastSeen, at: d.last_seen_at });
      toast.success(`${name} ab ${d.online ? "online" : "offline"} hai`);
    } catch {
      toast.error(`${name} ka status badal nahi paaye`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${name} ${on ? "online" : "offline"}, tap to switch`}
        onClick={flip}
        disabled={busy}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-rule bg-paper pr-3 pl-1 text-sm transition-colors duration-(--dur-micro) hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-55"
      >
        <span className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-(--dur-short) ${on ? "bg-good" : "bg-paper-3"}`}>
          <span className={`size-6 rounded-full bg-paper shadow-(--shadow-card) transition-transform duration-(--dur-short) ${on ? "translate-x-5" : ""}`} />
        </span>
        <span className="font-semibold text-ink">
          {compact ? "" : `${name}: `}
          {on ? "Online" : "Offline"}
        </span>
      </button>
      <button
        type="button"
        onClick={restart}
        disabled={busy}
        aria-label={`Remote restart ${name}`}
        title="Remote restart"
        className="inline-flex size-9 items-center justify-center rounded-full border border-rule bg-paper text-ink-3 transition-colors duration-(--dur-micro) hover:border-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
      >
        <RotateCw className="size-4" aria-hidden />
      </button>
    </span>
  );
}

// Every device for a merchant: a switch for what is in the shop, a grey tag for the rest.
// With exactly one device in the shop, it gets one plain "Soundbox: Online" switch.
export function DeviceList({ devices }: { devices: Dev[] }) {
  const withState = devices.map((d) => ({ d, s: deviceState(d.events) }));
  const inShop = withState.filter((x) => x.s === "in_shop");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {inShop.map(({ d }) => (
        <DeviceToggle
          key={d.id}
          id={d.id}
          model={d.model}
          name={inShop.length === 1 ? (d.model === "EDC" ? "EDC machine" : "Soundbox") : deviceName(d)}
          lastSeen={d.last_seen_at}
        />
      ))}
      {withState
        .filter((x) => x.s !== "in_shop")
        .map(({ d, s }) => (
          <span key={d.id} className="inline-flex h-7 items-center rounded-full bg-paper-3 px-2.5 text-sm text-ink-3">
            {deviceName(d)}, {s === "returned" ? "returned" : "never delivered"}
          </span>
        ))}
    </div>
  );
}
