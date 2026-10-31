import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { catalog, inject } from "@/inject";
import { reset } from "@/inject/reset";
import { drain } from "@/inject/watch";

export const maxDuration = 60;

// Fails closed: an unset INJECT_TOKEN locks the panel rather than opening it.
const tokenOk = (k: string | null, want = process.env.INJECT_TOKEN) =>
  !!want && !!k && k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));

// The panel's button list. Nothing secret, so it stays a static response.
export async function GET() {
  return NextResponse.json(catalog());
}

// { type, target: "demo" | "random" | "MID-xxxx", decoy?, failed?, count?, location? } or { reset: true }
export async function POST(req: Request) {
  if (!tokenOk(new URL(req.url).searchParams.get("k"))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  try {
    if (body.reset === true) return NextResponse.json({ ok: true, reset: true, ...(await reset()) });
    if (typeof body.type !== "string") return NextResponse.json({ ok: false, error: "type required" }, { status: 400 });
    const r = await inject(body.type, typeof body.target === "string" ? body.target : "random", {
      decoy: body.decoy === true, failed: body.failed === true,
      count: typeof body.count === "number" ? body.count : undefined, location: typeof body.location === "string" ? body.location : undefined,
    });
    // Detect right away instead of waiting for a dashboard's heartbeat: with only /m open (or no
    // browser at all) injections used to sit in the outbox. 1.7 s clears the watcher's 1.5 s debounce.
    after(async () => {
      await new Promise((r) => setTimeout(r, 1700));
      await drain().catch((e) => console.error("[inject] drain failed", (e as Error)?.message || e));
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const error = (err as Error)?.message || String(err);
    // Unknown type/merchant are the caller's mistake; anything else is ours.
    return NextResponse.json({ ok: false, error }, { status: /^unknown /.test(error) ? 400 : 500 });
  }
}
