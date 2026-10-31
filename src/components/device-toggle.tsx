"use client";

import { useState } from "react";
import { toast } from "sonner";

const OFFLINE_MS = 30 * 60 * 1000;
export const isOnline = (lastSeen: string) => Date.now() - new Date(lastSeen).getTime() <= OFFLINE_MS;

// Flips a device via POST /api/devices/<id>/status. Shows the server's answer until the next poll catches up.
export function DeviceToggle({ id, model, lastSeen, compact }: { id: string; model: string; lastSeen: string; compact?: boolean }) {
  const [seen, setSeen] = useState<{ from: string; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A newer poll value wins over our local echo.
  const at = seen && seen.from === lastSeen ? seen.at : lastSeen;
  const on = isOnline(at);
  const name = model === "EDC" ? "EDC machine" : "Soundbox";

  const flip = async () => {
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
  );
}
