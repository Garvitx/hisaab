import { NextResponse } from "next/server";
import { converse, conversationFor, logMessage } from "@/agent/concierge";
import * as merchants from "@/systems/merchants";

export const maxDuration = 60;

// Web fallback for /m/[mid]: the same concierge as WhatsApp. No auth (CLAUDE.md rule 6).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 1000) : "";
  const merchant = typeof body?.merchant_id === "string" ? await merchants.get(body.merchant_id) : null;
  if (!merchant || !text) return NextResponse.json({ error: "merchant_id and text required" }, { status: 400 });

  const conv = await conversationFor(merchant.id, "WEB");
  await logMessage({ conversation_id: conv.id, direction: "IN", type: "TEXT", text });
  const reply = await converse({ merchant, conversation_id: conv.id, text });
  await logMessage({ conversation_id: conv.id, direction: "OUT", type: "TEXT", text: reply });
  return NextResponse.json({ reply });
}
