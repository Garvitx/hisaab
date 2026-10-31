import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { ClaimError, claim, removeClaims } from "@/lib/claims";
import { sendText } from "@/channels/whatsapp";

const adminOk = (k: string | null, want = process.env.INJECT_TOKEN) =>
  !!want && !!k && k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));

const mask = (p: string) => `+${p.slice(0, 2)} ••••• ${p.slice(-4)}`;

// GET            → shops with free/taken/reserved (public, no phone numbers)
// GET ?id=…      → one claim's status, for the page to poll after "Open WhatsApp"
// GET ?k=ADMIN   → also every claim with its full number, for Remove / Remove all
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const b = await db.phoneBinding.findUnique({ where: { id }, select: { status: true, merchant_id: true } });
    return b ? NextResponse.json(b) : NextResponse.json({ status: "REMOVED" }, { status: 404 });
  }
  const [merchants, bindings] = await Promise.all([
    db.merchant.findMany({ orderBy: { id: "asc" }, select: { id: true, business_name: true, owner_name: true, city: true, segment: true, is_demo: true } }),
    db.phoneBinding.findMany({ orderBy: { created_at: "desc" } }),
  ]);
  const active = new Map(bindings.filter((b) => b.status === "ACTIVE").map((b) => [b.merchant_id, b]));
  const admin = adminOk(url.searchParams.get("k"));
  return NextResponse.json({
    shops: merchants.map((m) => ({
      ...m,
      state: m.is_demo ? "RESERVED" : active.has(m.id) ? "TAKEN" : "FREE",
      ...(active.has(m.id) ? { held_by: mask(active.get(m.id)!.phone) } : {}),
    })),
    ...(admin ? { claims: bindings.map((b) => ({ id: b.id, merchant_id: b.merchant_id, phone: `+${b.phone}`, display_name: b.display_name, status: b.status, created_at: b.created_at, activated_at: b.activated_at })) } : {}),
  });
}

// POST { mid, phone } → { id, code, business_name, wa_link }
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (typeof b?.mid !== "string" || typeof b?.phone !== "string") return NextResponse.json({ error: "mid and phone required" }, { status: 400 });
  try {
    return NextResponse.json(await claim(b.mid, b.phone));
  } catch (e) {
    if (e instanceof ClaimError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[claim] failed", (e as Error)?.message || e);
    return NextResponse.json({ error: "Could not claim right now. Try again." }, { status: 500 });
  }
}

// DELETE ?k=ADMIN with { id } or { all: true }. Linked phones are told they've been unlinked.
export async function DELETE(req: Request) {
  if (!adminOk(new URL(req.url).searchParams.get("k"))) return NextResponse.json({ error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const which = b?.all === true ? { all: true as const } : typeof b?.id === "string" ? { id: b.id } : null;
  if (!which) return NextResponse.json({ error: "id or all required" }, { status: 400 });
  const gone = await removeClaims(which);
  after(() =>
    Promise.all(gone.map((g) => sendText(g.phone, "Aapka number ab is demo shop se jud nahi raha. Dhanyavaad! Dobara khelne ke liye claim page par nayi shop chuniye.").catch(() => null))),
  );
  return NextResponse.json({ removed: "id" in which ? 1 : "all", unlinked_phones: gone.length });
}
