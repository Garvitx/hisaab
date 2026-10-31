import { NextResponse } from "next/server";
import { activeDemoMid, setActiveDemoMid } from "@/lib/demo";
import * as merchants from "@/systems/merchants";

// GET → { active_demo_mid }. PUT { active_demo_mid } switches who the demo WhatsApp phone speaks as.
export async function GET() {
  return NextResponse.json({ active_demo_mid: await activeDemoMid() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const mid = typeof body?.active_demo_mid === "string" ? body.active_demo_mid : "";
  if (!(await merchants.get(mid))) return NextResponse.json({ error: "unknown merchant" }, { status: 400 });
  await setActiveDemoMid(mid);
  return NextResponse.json({ active_demo_mid: mid });
}
