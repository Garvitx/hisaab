import { NextResponse } from "next/server";
import { drain } from "@/inject/watch";

export const maxDuration = 60;

// Dashboard heartbeats come unauthenticated (draining is harmless); n8n/cron send x-watch-secret.
async function handle(req: Request) {
  const r = await drain(req.headers.get("x-watch-secret"));
  return r ? NextResponse.json(r) : NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
}

export const POST = handle;
export const GET = handle;
