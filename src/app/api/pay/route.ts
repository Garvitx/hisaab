import { randomBytes, randomInt } from "node:crypto";
import { NextResponse, after } from "next/server";
import { drain } from "@/inject/watch";
import { onPayment } from "@/agent/payments";
import { db } from "@/lib/db";
import { qrSigOk } from "@/lib/qr-sig";
import * as merchants from "@/systems/merchants";

// The static shop QR's pay page: { mid, sig, payer_name, amount, pin, idem? } -> a SUCCESS payment.
// No real money moves; the outbox trigger fires like for any other payment.

// ponytail: in-memory, so both limits are per serverless instance (a second warm instance allows a second
// payment in the same 5 s, and a replayed idem key landing on another instance would insert again).
// Move both into a Postgres table keyed by ip / idem if that ever matters beyond the demo.
const lastPay = new Map<string, number>();
const ipHits = new Map<string, number[]>();
const done = new Map<string, Paid>();
const WINDOW_MS = 5000;
// A venue's Wi-Fi (or a carrier's NAT) puts a whole room behind one IP, so the 5 s limit is per
// device; the IP only gets a loose ceiling against scripted floods.
const IP_PER_MIN = 120;

type Paid = { txn_ref: string; amount: number; business_name: string; created_at: string };

export const maxDuration = 60;

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "payer";
const ipOf = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad(400, "Bad request.");
  // The signature binds the QR to one merchant: the only mid ever credited is the signed one.
  if (typeof b.mid !== "string" || !qrSigOk(b.mid, b.sig)) return bad(401, "This QR is not valid.");

  const name = typeof b.payer_name === "string" ? b.payer_name.trim() : "";
  if (name.length < 1 || name.length > 30) return bad(400, "Enter a name of 1 to 30 characters.");
  if (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > 5000) return bad(400, "Amount must be ₹1 to ₹5,000.");
  // Optional idempotency key: a retried attempt gets the same answer instead of a second payment.
  const idem = typeof b.idem === "string" && b.idem.length <= 64 ? `${b.mid}:${b.idem}` : null;
  const prev = idem && done.get(idem);
  if (prev) return NextResponse.json(prev);

  if (b.pin !== "1111") return bad(422, "Wrong PIN. The demo PIN is 1111.");

  const m = await merchants.get(b.mid);
  if (!m) return bad(404, "Merchant not found.");

  // Check and claim synchronously, so two concurrent requests from one device can't both pass.
  const ip = ipOf(req);
  const device = typeof b.device === "string" && /^[\w-]{8,64}$/.test(b.device) ? b.device : null;
  const key = device ? `d:${device}` : `ip:${ip}`;
  const now = Date.now();
  if (now - (lastPay.get(key) ?? 0) < WINDOW_MS) return bad(429, "One payment every 5 seconds. Try again shortly.");
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= IP_PER_MIN) return bad(429, "Too many payments from this network. Try again in a minute.");
  lastPay.set(key, now);
  ipHits.set(ip, [...hits, now]);
  if (lastPay.size > 5000) lastPay.clear(); // bounded; a cleared entry only forgets a 5 s window

  try {
    const p = await db.payment.create({
      data: {
        merchant_id: m.id,
        // 12-digit UPI RRN like the seed's; the 7 prefix keeps it clear of the seed's 61xxxxxxxxxx range.
        txn_ref: `7${randomInt(1e10, 1e11)}`,
        amount: b.amount,
        payer_vpa: `${slug(name)}@demo`,
        payer_name: name,
        order_ref: `DEMO-${randomBytes(4).toString("hex").toUpperCase()}`,
        status: "SUCCESS",
      },
    });
    const out: Paid = { txn_ref: p.txn_ref, amount: p.amount, business_name: m.business_name, created_at: p.created_at.toISOString() };
    if (done.size > 1000) done.clear(); // replays only matter for seconds; keep the map bounded
    if (idem) done.set(idem, out);
    // Run the cheap rules now (card-testing bursts) even when no dashboard is open.
    after(() => drain().catch((e) => console.error("[pay] drain failed", (e as Error)?.message || e)));
    after(() => onPayment(p.id).catch((e) => console.error("[pay] notify failed", (e as Error)?.message || e)));
    return NextResponse.json(out);
  } catch (err) {
    lastPay.delete(key);
    console.error("pay insert failed", err);
    return bad(500, "Payment failed. Nothing was charged. Try again.");
  }
}
