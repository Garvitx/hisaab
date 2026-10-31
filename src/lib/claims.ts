// "Claim a shop": a judge's WhatsApp number speaks as one merchant. A claim stays PENDING until
// "CLAIM <code>" arrives FROM that number, which proves they own it and opens WhatsApp's 24 h window.
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { digits, samePhone } from "@/channels/whatsapp";

// 10 digits = an Indian mobile without the country code. Anything shorter isn't a phone.
export function normalizePhone(raw: string) {
  const d = digits(raw);
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export class ClaimError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const reserved = (phone: string) =>
  samePhone(phone, process.env.OPS_EMPLOYEE_PHONE) || samePhone(phone, process.env.DEMO_MERCHANT_PHONE);

export async function claim(merchant_id: string, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new ClaimError("Enter a valid WhatsApp number.");
  if (reserved(phone)) throw new ClaimError("This number is reserved for the Hisaab team.");
  const m = await db.merchant.findUnique({ where: { id: merchant_id } });
  if (!m) throw new ClaimError("Shop not found.", 404);
  if (m.is_demo) throw new ClaimError("This shop is reserved for the live demo.", 409);
  const holder = await db.phoneBinding.findFirst({ where: { merchant_id, status: "ACTIVE", NOT: { phone } } });
  if (holder) throw new ClaimError("Someone already runs this shop. Pick another one.", 409);
  // One row per phone: claiming a new shop replaces this phone's old claim.
  const code = String(randomInt(1000, 10000));
  const b = await db.phoneBinding.upsert({
    where: { phone },
    create: { phone, merchant_id, code },
    update: { merchant_id, code, status: "PENDING", activated_at: null, created_at: new Date() },
  });
  const agent = digits(process.env.AGENT_WA_NUMBER);
  return { id: b.id, code, business_name: m.business_name, wa_link: `https://wa.me/${agent}?text=${encodeURIComponent(`CLAIM ${code}`)}` };
}

// Called for an inbound "CLAIM 1234". Returns the merchant on success, or why it failed.
export async function activate(fromPhone: string, code: string) {
  const b = await db.phoneBinding.findUnique({ where: { phone: digits(fromPhone) } });
  if (!b || b.code !== code) return { ok: false as const, reason: "Ye code is number se match nahi karta. Claim page par dobara shop chuniye." };
  if (b.status === "ACTIVE") return { ok: true as const, merchant_id: b.merchant_id, already: true };
  const holder = await db.phoneBinding.findFirst({ where: { merchant_id: b.merchant_id, status: "ACTIVE", NOT: { id: b.id } } });
  if (holder) return { ok: false as const, reason: "Ye shop abhi kisi aur ne le li. Claim page par doosri shop chuniye." };
  await db.phoneBinding.update({ where: { id: b.id }, data: { status: "ACTIVE", activated_at: new Date() } });
  return { ok: true as const, merchant_id: b.merchant_id, already: false };
}

// "JOIN HISAAB" from WhatsApp: the message itself proves the phone, so the claim is ACTIVE at once,
// on a random free shop. A phone that already holds a shop gets that one back.
export const MAX_ACTIVE = 15;

export async function join(fromPhone: string, display_name: string | null) {
  const phone = digits(fromPhone);
  if (reserved(phone)) return { ok: false as const, reason: "Ye number Hisaab team ke liye reserved hai." };
  const mine = await db.phoneBinding.findUnique({ where: { phone } });
  if (mine?.status === "ACTIVE") return { ok: true as const, merchant_id: mine.merchant_id, already: true };
  if ((await db.phoneBinding.count({ where: { status: "ACTIVE" } })) >= MAX_ACTIVE)
    return { ok: false as const, reason: "Maaf kijiye, abhi saari demo dukaanein le li gayi hain. Thodi der baad JOIN HISAAB dobara bhejiye." };
  // Free = not demo and no claim by anyone else, PENDING included (that judge is mid-claim).
  const free = await db.merchant.findMany({
    where: { is_demo: false, id: { notIn: (await db.phoneBinding.findMany({ where: { NOT: { phone } }, select: { merchant_id: true } })).map((b) => b.merchant_id).concat("MID-0001") } },
    select: { id: true },
  });
  if (!free.length) return { ok: false as const, reason: "Maaf kijiye, abhi saari demo dukaanein le li gayi hain. Thodi der baad JOIN HISAAB dobara bhejiye." };
  // ponytail: two JOINs in the same instant can land on one shop; a unique index on active merchant_id fixes it if it ever happens.
  const merchant_id = free[randomInt(free.length)].id;
  const data = { merchant_id, code: String(randomInt(1000, 10000)), display_name, status: "ACTIVE" as const, activated_at: new Date() };
  await db.phoneBinding.upsert({ where: { phone }, create: { phone, ...data }, update: { ...data, created_at: new Date() } });
  return { ok: true as const, merchant_id, already: false };
}

export async function boundMerchant(phone: string) {
  const b = await db.phoneBinding.findUnique({ where: { phone: digits(phone) } });
  return b?.status === "ACTIVE" ? b.merchant_id : null;
}

export async function phonesFor(merchant_id: string) {
  return (await db.phoneBinding.findMany({ where: { merchant_id, status: "ACTIVE" }, select: { phone: true } })).map((b) => b.phone);
}

// Admin: remove one claim or all. Returns the ACTIVE phones so the caller can tell them.
export async function removeClaims(which: { id: string } | { all: true }) {
  const where = "id" in which ? { id: which.id } : {};
  const rows = await db.phoneBinding.findMany({ where, select: { phone: true, status: true, merchant_id: true } });
  await db.phoneBinding.deleteMany({ where });
  return rows.filter((r) => r.status === "ACTIVE");
}
