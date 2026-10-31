// A bare "Haan" / "Nahi" on WhatsApp, answered in code before the concierge: it confirms the drafts
// just shown, or answers another shop's udhaar request. Anything else returns null and goes on to the model.
import { db } from "@/lib/db";
import { confirm, pendingForMe, respond, rs } from "./entries";

const YES = /^\s*(haan|haa|ha|han|haanji|haan ji|ji haan|yes|y|sahi hai|sahi|theek hai|thik hai|ok|okay)\s*[.!]*\s*$/i;
const NO = /^\s*(nahi|nahin|na|no|n|galat|galat hai)\s*[.!]*\s*$/i;
const FRESH_MS = 30 * 60_000; // drafts older than this aren't what a "haan" refers to

export async function khataQuickReply(merchant_id: string, text: string): Promise<string | null> {
  const yes = YES.test(text);
  if (!yes && !NO.test(text)) return null;
  const drafts = await db.khataEntry.count({ where: { merchant_id, status: "DRAFT", created_at: { gte: new Date(Date.now() - FRESH_MS) } } });
  if (drafts) {
    if (!yes) return null; // "nahi" to drafts means "badlo": the concierge asks what to change
    const r = await confirm(merchant_id, (await db.khataEntry.findMany({ where: { merchant_id, status: "DRAFT", created_at: { gte: new Date(Date.now() - FRESH_MS) } }, select: { id: true } })).map((e) => e.id));
    const lines = r.confirmed.map((d) => `- ${d.label}`);
    const asked = r.waiting_for_ok_from.map((w) => `${w.name} ko bhi poocha hai, unki haan ka intezaar hai.`);
    const ask = r.needs_choice.map((d) => `${d.counterparty.name} kaun hai? ${d.choices?.map((c) => c.name).join(" ya ") ?? ""}`);
    return [lines.length ? "Likh liya:" : "", ...lines, ...asked, ...ask].filter(Boolean).join("\n") || null;
  }
  if (!(await pendingForMe(merchant_id)).length) return null;
  const r = await respond(merchant_id, yes);
  return yes
    ? `Theek hai, ${r.with} ke saath ${rs(r.amount)} ka udhaar aapke khate mein likh diya.`
    : `Theek hai, ${r.with} ko bata diya ki ${rs(r.amount)} ka udhaar sahi nahi hai.`;
}
