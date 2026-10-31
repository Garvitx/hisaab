// Concierge tools for the khata. merchant_id comes from ctx (the verified sender), never the model,
// and the model never passes an amount for a new entry: add_khata_entries reads the merchant's own
// last message and the extractor plus code turn it into drafts.
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { istDay } from "@/engine/queries";
import { addDrafts, confirm, draftReply, drafts, editDraft, respond } from "./entries";
import { khataPeriod, udhaarBalances } from "./balances";
import { sendReminder } from "./settle";
import { resolveCounterparty } from "./words";
import { readKhataPhoto } from "./photo";

type Ctx = { merchant_id: string; conversation_id: string; phone?: string | null; voice?: boolean };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });

export const KHATA_TOOLS: Anthropic.Tool[] = [
  { name: "add_khata_entries", description: "The merchant told you about cash sales, cash expenses or udhaar (credit) to write in their khata: 'aaj 3400 cash aaya', '200 ka doodh liya', 'Gupta ko 300 udhaar diya', OR sent a PHOTO of their khata page / list with a caption like 'add as income' or 'udhaar likh do'. Reads the merchant's latest message (and its photo) itself (never pass amounts) and saves DRAFTS only. Send the returned `reply` as it is.", input_schema: obj({}) },
  { name: "confirm_khata_entries", description: "The merchant said 'haan' / 'sahi hai' to the khata drafts: confirm them (all drafts, or only entry_ids). Udhaar with another Paytm shop is then sent to that shop for their Haan.", input_schema: obj({ entry_ids: { type: "array", items: { type: "string" } } }) },
  { name: "edit_khata_entry", description: "Change one khata draft before it is confirmed: the amount the merchant corrected ('300 nahi 400'), delete it, or pick who an ambiguous name meant (choice = index in that draft's choices). Only amounts the merchant said.", input_schema: obj({ entry_id: { type: "string" }, amount: { type: "integer" }, delete: { type: "boolean" }, choice: { type: "integer" } }, ["entry_id"]) },
  { name: "get_khata", description: "The merchant's khata for a period: UPI (verified by Paytm) and cash, expenses, udhaar (self-reported, 'aapne bataya'), kept apart. period: 'today', YYYY-MM-DD or YYYY-MM.", input_schema: obj({ period: { type: "string" } }) },
  { name: "get_udhaar_balances", description: "Udhaar per person or shop: lene (they owe the merchant), dene (the merchant owes), settled, and requests waiting for a Haan / Nahi. Use for 'kisne kitna dena hai', 'mera udhaar kitna hai'.", input_schema: obj({}) },
  { name: "send_udhaar_reminder", description: "Send a payment reminder with a Paytm pay link to someone who owes the merchant ('Gupta Sweets ko reminder bhejo'). counterparty = the name as the merchant said it.", input_schema: obj({ counterparty: { type: "string" } }, ["counterparty"]) },
  { name: "respond_udhaar", description: "Another shop wrote that this merchant owes them (or they owe this merchant) and asked 'Sahi hai? Haan / Nahi': record the merchant's answer. accept=true for haan.", input_schema: obj({ accept: { type: "boolean" }, entry_id: { type: "string" } }, ["accept"]) },
];
export const KHATA_TOOL_NAMES = new Set(KHATA_TOOLS.map((t) => t.name));

function period(p: unknown) {
  const s = typeof p === "string" ? p.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return [s, s] as const;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    return [`${s}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)] as const;
  }
  return [istDay(), istDay()] as const;
}

type In = { entry_ids?: string[]; entry_id?: string; choice?: number; amount?: number; delete?: boolean; period?: string; counterparty?: string; accept?: boolean };

export async function khataTool(name: string, input: In, ctx: Ctx): Promise<unknown> {
  const mid = ctx.merchant_id;
  switch (name) {
    case "add_khata_entries": {
      const last = await db.message.findFirst({ where: { conversation_id: ctx.conversation_id, direction: "IN" }, orderBy: { created_at: "desc" } });
      let said = last?.transcript ?? last?.text ?? "";
      // A photo of the khata page: transcribe it, then extract from caption + page like any message.
      if (last?.type === "IMAGE" && last.media_url) {
        const page = await readKhataPhoto(last.media_url, ctx.conversation_id);
        if (!page) return { drafts: [], reply: "Photo mein koi entry padh nahi paaya. Thodi saaf photo bhejiye, ya likh kar bataiye.", note: "Send `reply` exactly." };
        said = `${said ? `${said}\n` : ""}${page}`;
      }
      const r = await addDrafts(mid, said, !ctx.phone ? "DASHBOARD" : ctx.voice ? "WA_VOICE" : "WA_TEXT", ctx.conversation_id);
      return { drafts: r.drafts, reply: r.reply, note: "Send `reply` exactly. Nothing is saved for real until the merchant says haan." };
    }
    case "confirm_khata_entries": {
      const r = await confirm(mid, Array.isArray(input.entry_ids) ? input.entry_ids : undefined);
      return { ...r, note: r.confirmed.length ? "Confirmed. Shops in waiting_for_ok_from were asked to say Haan on their side." : "Nothing was waiting to confirm." };
    }
    case "edit_khata_entry": {
      const all = await drafts(mid);
      const d = all.find((x) => x.id === input.entry_id);
      if (!d) throw new Error("draft not found");
      const choice = typeof input.choice === "number" ? d.choices?.[input.choice] : undefined;
      await editDraft(mid, d.id, { amount: input.amount, delete: !!input.delete, choice });
      return { reply: draftReply(await drafts(mid)) };
    }
    case "get_khata": {
      const [from, to] = period(input.period);
      return khataPeriod(mid, from, to);
    }
    case "get_udhaar_balances": {
      const b = await udhaarBalances(mid);
      return { balances: b.map(({ key: _k, remind_entry_id: _r, pay_entry: _p, ...x }) => x), note: "Self-reported udhaar (aapne bataya); only settlements through Paytm links are verified." };
    }
    case "send_udhaar_reminder": {
      const b = (await udhaarBalances(mid)).filter((x) => x.lene > 0);
      const r = resolveCounterparty(String(input.counterparty ?? ""), b.filter((x) => x.mid).map((x) => ({ id: x.mid!, business_name: x.name })), b.filter((x) => !x.mid).map((x) => x.name), mid);
      if (!r || r.type === "AMBIGUOUS") return { ask: `Kisko? ${b.map((x) => x.name).join(", ") || "Kisi ka udhaar baaki nahi hai."}` };
      const hit = b.find((x) => (r.type === "MERCHANT" ? x.mid === r.mid : x.name.toLowerCase() === r.name.toLowerCase()));
      if (!hit) return { not_found: true, owing: b.map((x) => x.name) };
      const s = await sendReminder(mid, hit.key);
      return { ...s, note: s.sent ? "Reminder sent with the pay link." : "Their phone is not on Hisaab: give the merchant the link to forward, or the QR on the dashboard." };
    }
    case "respond_udhaar":
      return respond(mid, !!input.accept, typeof input.entry_id === "string" ? input.entry_id : undefined);
  }
  throw new Error(`unknown tool ${name}`);
}
