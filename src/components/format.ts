// Shared by server routes and client components.

// JSON over the wire turns Dates into strings; client types follow that.
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const inr = (n: number | null | undefined) => (n == null ? "–" : `₹${inrFmt.format(n)}`);
export const count = (n: number) => inrFmt.format(n);

export function ago(d: string | Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const day = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const dayYear = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export const time = (d: string | Date) =>
  new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });

export function seconds(ms: number | null | undefined) {
  if (ms == null) return "–";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// "2026-06" -> "June 2026"
export function month(period: string | null | undefined) {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
