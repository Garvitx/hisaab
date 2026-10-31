import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as merchants from "@/systems/merchants";

// The demo pay page: { mid, k, name, amount, pin, idem } -> a SUCCESS payment.
// No real money moves; the outbox trigger fires like for any other payment.

const tokenOk = (k: unknown, want = process.env.PAY_TOKEN) =>
  !!want && typeof k === "string" && k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));

// ponytail: in-memory, so both limits are per serverless instance (a second warm instance allows a second
// payment in the same 5 s, and a replayed idem key landing on another instance would insert again).
// Move both into a Postgres table keyed by ip / idem if that ever matters beyond the demo.
const lastPay = new Map<string, number>();
const done = new Map<string, Paid>();
const WINDOW_MS = 5000;

type Paid = { txn_ref: string; amount: number; business_name: string; created_at: string };

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "payer";
const ipOf = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad(400, "Bad request.");
  if (!tokenOk(b.k)) return bad(401, "This pay link is not valid.");

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 30) return bad(400, "Enter a name of 1 to 30 characters.");
  if (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > 5000) return bad(400, "Amount must be ₹1 to ₹5,000.");
  if (typeof b.mid !== "string") return bad(400, "Bad request.");
  const idem = typeof b.idem === "string" && b.idem.length <= 64 ? b.idem : null;
  if (!idem) return bad(400, "Bad request.");

  // A retried attempt gets the same answer instead of a second payment.
  const prev = done.get(idem);
  if (prev) return NextResponse.json(prev);

  if (b.pin !== "1111") return bad(422, "Wrong PIN. The demo PIN is 1111.");

  const m = await merchants.get(b.mid);
  if (!m) return bad(404, "Merchant not found.");

  // Check and claim synchronously, so two concurrent requests from one IP can't both pass.
  const ip = ipOf(req);
  const now = Date.now();
  if (now - (lastPay.get(ip) ?? 0) < WINDOW_MS) return bad(429, "One payment every 5 seconds. Try again shortly.");
  lastPay.set(ip, now);

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
    done.set(idem, out);
    return NextResponse.json(out);
  } catch (err) {
    lastPay.delete(ip);
    console.error("pay insert failed", err);
    return bad(500, "Payment failed. Nothing was charged. Try again.");
  }
}
