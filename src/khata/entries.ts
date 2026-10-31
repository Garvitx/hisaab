// Drafts -> confirmed khata entries, and the inter-merchant mirror (Haan / Nahi).
// Self-reported money: nothing here is ever read by reconcile, verifiers, policy or executors.
import { db } from "@/lib/db";
import type { KhataEntry, KhataKind, KhataSource, Merchant } from "@/generated/prisma/client";
import { istDay } from "@/engine/queries";
import { directory, extractKhataEntries } from "./extract";
import { resolveCounterparty, type Resolved } from "./words";

export const entryDate = (day = istDay()) => new Date(`${day}T00:00:00Z`); // @db.Date column
export const rs = (n: number) => `Rs ${n.toLocaleString("en-IN")}`;
export const isUdhaar = (k: KhataKind) => k === "UDHAAR_GIVEN" || k === "UDHAAR_TAKEN";
const flip = (k: KhataKind): KhataKind => (k === "UDHAAR_GIVEN" ? "UDHAAR_TAKEN" : "UDHAAR_GIVEN");
const MAX = 10_000_000;

type Row = Pick<KhataEntry, "id" | "kind" | "amount" | "counterparty_type" | "counterparty_name" | "counterparty_mid" | "note" | "status">;
type Choice = { type: "MERCHANT"; mid: string; name: string } | { type: "CUSTOMER"; name: string };
export type Draft = { id: string; kind: KhataKind; amount: number; label: string; counterparty: { type: string; name: string | null; mid: string | null }; note: string | null; choices?: Choice[] };

// Udhaar with no resolved counterparty is how an ambiguous name is parked ("Gupta" = two shops).
const unresolved = (e: Row) => isUdhaar(e.kind) && e.counterparty_type === "NONE";

// One plain line per entry: "Udhaar diya Rs 300, Gupta General Store (merchant)".
export function label(e: Row) {
  const who = e.counterparty_name ? `, ${e.counterparty_name}${e.counterparty_type === "MERCHANT" ? " (merchant)" : ""}` : "";
  const what = e.note ? ` (${e.note})` : "";
  if (e.kind === "CASH_SALE") return `Cash mila ${rs(e.amount)}${what}`;
  if (e.kind === "CASH_EXPENSE") return `Kharcha ${rs(e.amount)}${what}`;
  return `${e.kind === "UDHAAR_GIVEN" ? "Udhaar diya" : "Udhaar liya"} ${rs(e.amount)}${who}${unresolved(e) ? " (kaun?)" : ""}`;
}

async function view(rows: Row[], merchant_id: string): Promise<Draft[]> {
  const dir = rows.some(unresolved) ? await directory(merchant_id) : null;
  return rows.map((e) => {
    const r = dir && unresolved(e) ? resolveCounterparty(e.counterparty_name ?? "", dir.shops, dir.customers, merchant_id) : null;
    return {
      id: e.id,
      kind: e.kind,
      amount: e.amount,
      label: label(e),
      counterparty: { type: e.counterparty_type, name: e.counterparty_name, mid: e.counterparty_mid },
      note: e.note,
      ...(r?.type === "AMBIGUOUS" ? { choices: r.choices } : {}),
    };
  });
}

const cp = (r: Resolved | null) =>
  !r ? { counterparty_type: "NONE" as const, counterparty_name: null, counterparty_mid: null }
  : r.type === "MERCHANT" ? { counterparty_type: "MERCHANT" as const, counterparty_name: r.name, counterparty_mid: r.mid }
  : r.type === "CUSTOMER" ? { counterparty_type: "CUSTOMER" as const, counterparty_name: r.name, counterparty_mid: null }
  : { counterparty_type: "NONE" as const, counterparty_name: r.name, counterparty_mid: null };

// The numbered list WhatsApp shows; also the tool's ready reply.
export function draftReply(drafts: Draft[]) {
  if (!drafts.length) return "Isme koi hisaab ki entry nahi mili. Aise likhiye: 'aaj 3400 cash aaya' ya 'Gupta ko 300 udhaar diya'.";
  const lines = drafts.map((d, i) => `${i + 1}. ${d.label}`);
  const ask = drafts.filter((d) => d.choices).map((d) => `${d.counterparty.name} se matlab: ${d.choices!.map((c) => c.name).join(" ya ")}?`);
  return [`Maine ye likha hai:`, ...lines, ...ask, "Sahi hai? Haan / Badlo"].join("\n");
}

// Merchant's words -> DRAFT rows. Nothing is confirmed here.
export async function addDrafts(merchant_id: string, transcript: string, source: KhataSource, conversation_id?: string | null) {
  const found = await extractKhataEntries(transcript, merchant_id, conversation_id);
  const rows = found.length
    ? await db.khataEntry.createManyAndReturn({
        data: found.map((e) => ({ merchant_id, kind: e.kind, amount: e.amount, ...cp(e.counterparty), counterparty_phone: e.phone, note: e.note, source, transcript: e.span, entry_date: entryDate() })),
      })
    : [];
  const drafts = await view(rows, merchant_id);
  return { transcript, drafts, reply: draftReply(drafts) };
}

export async function drafts(merchant_id: string, since?: Date) {
  const rows = await db.khataEntry.findMany({ where: { merchant_id, status: "DRAFT", created_at: since ? { gte: since } : undefined }, orderBy: { created_at: "asc" } });
  return view(rows, merchant_id);
}

const ownDraft = async (merchant_id: string, id: string) => {
  const e = await db.khataEntry.findUnique({ where: { id } });
  if (!e || e.merchant_id !== merchant_id || e.status !== "DRAFT") throw new Error("draft not found");
  return e;
};

// "Edit amount", "Delete", or picking who an ambiguous name meant. Drafts only.
export async function editDraft(merchant_id: string, id: string, ch: { amount?: number; delete?: boolean; choice?: Choice }) {
  await ownDraft(merchant_id, id);
  if (ch.delete) return db.khataEntry.update({ where: { id }, data: { status: "DELETED" } });
  if (ch.amount != null && (!Number.isInteger(ch.amount) || ch.amount < 1 || ch.amount > MAX)) throw new Error("amount must be whole rupees");
  let who = {};
  if (ch.choice) {
    // A merchant choice must be a real shop (and not this one); its name comes from the table, not the caller.
    if (ch.choice.type === "MERCHANT") {
      const m = ch.choice.mid !== merchant_id ? await db.merchant.findUnique({ where: { id: ch.choice.mid } }) : null;
      if (!m) throw new Error("shop not found");
      who = cp({ type: "MERCHANT", mid: m.id, name: m.business_name });
    } else who = cp({ type: "CUSTOMER", name: ch.choice.name.trim().slice(0, 60) || "Customer" });
  }
  return db.khataEntry.update({ where: { id }, data: { ...(ch.amount != null ? { amount: ch.amount } : {}), ...who } });
}

// The merchant's tap or "Haan". Udhaar with another of our merchants writes the mirror entry in
// their khata as PENDING_CONFIRMATION until they say Haan / Nahi.
export async function confirm(merchant_id: string, ids?: string[]) {
  const rows = await db.khataEntry.findMany({ where: { merchant_id, status: "DRAFT", ...(ids?.length ? { id: { in: ids } } : {}) }, orderBy: { created_at: "asc" } });
  const ready = rows.filter((e) => !unresolved(e));
  const mirrors: KhataEntry[] = [];
  const me = await db.merchant.findUniqueOrThrow({ where: { id: merchant_id } });
  for (const e of ready) {
    const mirror = await db.$transaction(async (tx) => {
      // Claim the draft first: a double tap (or tap + WhatsApp "haan") confirms it once.
      const { count } = await tx.khataEntry.updateMany({ where: { id: e.id, status: "DRAFT" }, data: { status: "CONFIRMED" } });
      if (!count || !isUdhaar(e.kind) || e.counterparty_type !== "MERCHANT" || !e.counterparty_mid) return null;
      const m = await tx.khataEntry.create({
        data: { merchant_id: e.counterparty_mid, kind: flip(e.kind), amount: e.amount, counterparty_type: "MERCHANT", counterparty_name: me.business_name, counterparty_mid: merchant_id, note: e.note, source: e.source, status: "PENDING_CONFIRMATION", linked_entry_id: e.id, entry_date: e.entry_date },
      });
      await tx.khataEntry.update({ where: { id: e.id }, data: { linked_entry_id: m.id } });
      return m;
    });
    if (mirror) mirrors.push(mirror);
  }
  for (const m of mirrors) await askCounterparty(me, m).catch((err) => console.error("[khata] mirror notify failed", (err as Error)?.message));
  return {
    confirmed: await view(ready, merchant_id),
    waiting_for_ok_from: mirrors.map((m) => ({ name: ready.find((e) => e.id === m.linked_entry_id)?.counterparty_name, amount: m.amount })),
    needs_choice: await view(rows.filter(unresolved), merchant_id),
  };
}

// "Ramesh Kirana Store ne likha hai ki aapko Rs 300 dene hain. Sahi hai? Haan / Nahi"
export const askText = (from: string, mirror: Pick<KhataEntry, "kind" | "amount">) =>
  mirror.kind === "UDHAAR_TAKEN"
    ? `${from} ne likha hai ki aapko ${rs(mirror.amount)} dene hain. Sahi hai? Haan / Nahi`
    : `${from} ne likha hai ki unhe aapko ${rs(mirror.amount)} dene hain. Sahi hai? Haan / Nahi`;

async function askCounterparty(from: Merchant, mirror: KhataEntry) {
  const other = await db.merchant.findUnique({ where: { id: mirror.merchant_id } });
  if (!other) return;
  // say(): claimed phones and the demo phone get WhatsApp; everyone else gets the dashboard mirror.
  const { say } = await import("@/agent/outreach");
  await say(other, askText(from.business_name, mirror), { topic: "udhaar" });
}

// Requests waiting for THIS merchant's Haan / Nahi.
export const pendingForMe = (merchant_id: string) =>
  db.khataEntry.findMany({ where: { merchant_id, status: "PENDING_CONFIRMATION" }, orderBy: { created_at: "asc" } });

// The counterparty's Haan (both CONFIRMED) or Nahi (both DISPUTED). No id = the oldest open request.
export async function respond(merchant_id: string, accept: boolean, entry_id?: string) {
  const e = entry_id ? await db.khataEntry.findUnique({ where: { id: entry_id } }) : (await pendingForMe(merchant_id))[0];
  if (!e || e.merchant_id !== merchant_id || e.status !== "PENDING_CONFIRMATION") throw new Error("no udhaar request waiting for you");
  const status = accept ? "CONFIRMED" : "DISPUTED";
  const ids = [e.id, ...(e.linked_entry_id ? [e.linked_entry_id] : [])];
  await db.$transaction(async (tx) => {
    const { count } = await tx.khataEntry.updateMany({ where: { id: e.id, status: "PENDING_CONFIRMATION" }, data: { status } });
    if (!count) throw new Error("already answered");
    await tx.khataEntry.updateMany({ where: { id: { in: ids.slice(1) } }, data: { status } });
  });
  const [me, origin] = await Promise.all([db.merchant.findUnique({ where: { id: merchant_id } }), e.counterparty_mid ? db.merchant.findUnique({ where: { id: e.counterparty_mid } }) : null]);
  if (me && origin) {
    const text = accept
      ? `${me.business_name} ne maan liya: ${rs(e.amount)} ka udhaar ab dono khaton mein pakka hai.`
      : `${me.business_name} ne kaha ki ${rs(e.amount)} ka udhaar sahi nahi hai. Entry ab vivaad (disputed) mein hai, ek baar unse baat kar lijiye.`;
    const { say } = await import("@/agent/outreach");
    await say(origin, text, { topic: "udhaar" }).catch((err) => console.error("[khata] respond notify failed", (err as Error)?.message));
  }
  return { status, amount: e.amount, with: e.counterparty_name };
}
