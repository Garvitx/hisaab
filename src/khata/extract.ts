// Merchant's words -> draft khata entries. Shared by the NFC tap page and WhatsApp.
// The model only splits the sentence into entries; who the counterparty is gets decided in code,
// and amounts said in words are re-read in code where possible. Every entry is a draft until the
// merchant confirms it.
import { db } from "@/lib/db";
import { MODEL, json } from "@/agent/llm";
import type { KhataKind } from "@/generated/prisma/client";
import { parseAmount, resolveCounterparty, type Resolved } from "./words";

const KINDS = ["CASH_SALE", "CASH_EXPENSE", "UDHAAR_GIVEN", "UDHAAR_TAKEN"] as const;

const SYSTEM = `You turn what an Indian shopkeeper said (Hinglish, Hindi or English, usually a speech transcript) into khata (account book) entries.

Kinds:
- CASH_SALE: cash received from sales ("aaj 3400 cash aaya", "paanch sau cash mile").
- CASH_EXPENSE: money the shop spent in cash ("200 ka doodh liya", "bijli ka bill 1500 bhara", "chai 50").
- UDHAAR_GIVEN: credit given; someone now owes the shop ("Gupta ko 300 udhaar diya", "Priya ne 200 baad mein dene hain", "Sharma ji ka 500 khate mein likh do").
- UDHAAR_TAKEN: credit taken; the shop now owes someone ("Agarwal se 1000 udhaar liya", "mujhe Ganesh wale ko 500 dene hain").

Rules:
- One entry per amount mentioned. Never invent an entry or an amount that was not said.
- amount: whole rupees as a number. Read Hindi number words: "paanch sau" 500, "dedh hazaar" 1500, "dhai sau" 250, "saade teen hazaar" 3500, "sava do sau" 225, "paune do hazaar" 1750.
- counterparty: for udhaar, the person or shop exactly as said, without "ko/se/ne" (e.g. "Gupta wale", "Priya", "Gupta General Store"). Empty string for cash entries unless a name was said.
- phone: digits if a phone number was said for that person, else "".
- note: a few words on what it was for, in the merchant's words (e.g. "doodh", "mithai ka maal"), else "".
- span: the exact part of the input this entry came from, copied character for character.
- If nothing in the input is a khata entry, return an empty list.`;

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...KINDS] },
          amount: { type: "integer" },
          counterparty: { type: "string" },
          phone: { type: "string" },
          note: { type: "string" },
          span: { type: "string" },
        },
        required: ["kind", "amount", "counterparty", "phone", "note", "span"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

type Raw = { kind: KhataKind; amount: number; counterparty: string; phone: string; note: string; span: string };
export type Extracted = { kind: KhataKind; amount: number; counterparty: Resolved | null; phone: string | null; note: string | null; span: string };

// The counterparty lookup tables: all shops, and the customers already in this khata.
export async function directory(merchant_id: string) {
  const [shops, rows] = await Promise.all([
    db.merchant.findMany({ select: { id: true, business_name: true } }),
    db.khataEntry.findMany({ where: { merchant_id, counterparty_type: "CUSTOMER", status: { not: "DELETED" } }, distinct: ["counterparty_name"], select: { counterparty_name: true } }),
  ]);
  return { shops, customers: rows.map((r) => r.counterparty_name).filter((n): n is string => !!n) };
}

export async function extractKhataEntries(transcript: string, merchant_id: string, conversation_id?: string | null): Promise<Extracted[]> {
  const text = transcript.trim().slice(0, 2000);
  if (!text) return [];
  const [out, dir] = await Promise.all([
    json<{ entries: Raw[] }>({ model: MODEL.converse(), system: SYSTEM, user: text, schema: SCHEMA, meta: { role: "KHATA", conversation_id } }),
    directory(merchant_id),
  ]);
  return out.entries
    .filter((e) => KINDS.includes(e.kind as (typeof KINDS)[number]))
    .map((e) => {
      // The span must really be in what was said; a paraphrased span falls back to the whole input.
      const span = e.span && text.toLowerCase().includes(e.span.toLowerCase()) ? e.span : text;
      const phone = e.phone.replace(/\D/g, "");
      // Code reads the amount from the span when it can (deterministic); else the model's reading
      // stands, unless it is really a piece of the phone number that was said.
      const fromModel = phone.length >= 10 && String(e.amount).length >= 4 && phone.includes(String(e.amount)) ? 0 : e.amount;
      // A span that fell back to the whole input says nothing about this entry when there are several.
      const amount = ((span !== text || out.entries.length === 1) && parseAmount(span)) || fromModel;
      const udhaar = e.kind === "UDHAAR_GIVEN" || e.kind === "UDHAAR_TAKEN";
      // Only udhaar needs a counterparty. On a cash sale "Sharma ji" is a customer, not Sharma Medical
      // Hall, so the name goes into the note and is never matched to a shop.
      const who = e.counterparty.trim();
      const counterparty = udhaar && who ? resolveCounterparty(who, dir.shops, dir.customers, merchant_id) : null;
      const note = [!udhaar ? who : "", e.note.trim()].filter(Boolean).join(": ") || null;
      return { kind: e.kind, amount, counterparty, phone: phone.length >= 10 ? phone : null, note, span };
    })
    .filter((e) => Number.isInteger(e.amount) && e.amount > 0 && e.amount <= 10_000_000);
}
