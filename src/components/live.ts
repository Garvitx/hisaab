"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// ponytail: plain setInterval polling (CLAUDE.md: 1.5 s, no websockets). SWR-style dedupe if many widgets share a URL.
export function usePoll<T>(url: string | null, ms = 1500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      const mine = ++tick.current;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = (await r.json()) as T;
        if (alive && mine === tick.current) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "failed");
      } finally {
        busy = false;
      }
    };
    run();
    const id = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url, ms]);

  return { data, error, loading: !data && !error };
}

export type Beat = { at: number; ok: boolean; info?: unknown };

// The dashboard heartbeat that drives detection (CLAUDE.md § 6, watcher A).
export function useHeartbeat(ms = 1500) {
  const [beat, setBeat] = useState<Beat | null>(null);
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch("/api/watch", { method: "POST" });
        const info = await r.json().catch(() => null);
        setBeat({ at: Date.now(), ok: r.ok, info });
      } catch {
        setBeat({ at: Date.now(), ok: false });
      } finally {
        busy = false;
      }
    };
    run();
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  }, [ms]);
  return beat;
}

// ---- sound: off until a user gesture turns it on (autoplay policy) ----

const KEY = "hisaab:sound";
const subs = new Set<() => void>();
let ctx: AudioContext | null = null;

function readSound() {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  if (on) {
    ctx ??= new AudioContext();
    void ctx.resume();
    chime();
  }
  subs.forEach((f) => f());
}

export function useSound() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    readSound,
    () => false,
  );
}

// Two-note chime, synthesised (no audio files).
export function chime() {
  if (!readSound()) return;
  ctx ??= new AudioContext();
  const t = ctx.currentTime;
  [880, 1318.5].forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.12);
    g.gain.linearRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.6);
    o.connect(g).connect(ctx!.destination);
    o.start(t + i * 0.12);
    o.stop(t + i * 0.12 + 0.65);
  });
}

// Soundbox-style announcement from the voice agent's TTS route.
// Audio is cached per text (so per amount), plays one at a time, and falls back to the chime if TTS fails.
const clips = new Map<string, Promise<string>>();
let queue: Promise<void> = Promise.resolve();

function clip(text: string) {
  let p = clips.get(text);
  if (!p) {
    p = fetch(`/api/announce?text=${encodeURIComponent(text)}`).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => clips.delete(text)); // retry TTS next time
    clips.set(text, p);
  }
  return p;
}

export function announce(text: string) {
  if (!readSound()) return;
  queue = queue.then(async () => {
    try {
      const a = new Audio(await clip(text));
      await a.play();
      await new Promise<void>((done) => {
        a.onended = () => done();
        a.onerror = () => done();
        setTimeout(done, 8000);
      });
    } catch {
      chime();
    }
  });
}
