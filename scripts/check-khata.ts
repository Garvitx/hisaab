// Run: pnpm dev --port 3204, then ALLOW_LIVE_CHECKS=1 tsx scripts/check-khata.ts
// (/api/pay is driven over HTTP: its after() hooks need a real request scope. CHECK_BASE_URL overrides.)
// The khata end to end on two non-demo shops (MID-0010 creditor, MID-0005 Gupta General Store debtor):
// extraction -> drafts -> confirm -> mirror -> Haan -> reminder link -> /api/pay with u (partial, then
// the rest) -> daily_summary. Sends stay off (CHAKRA_API_KEY empty). Deletes every row it wrote.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database (khata rows, payments, messages). Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

const C = "MID-0010"; // creditor
const D = "MID-0005"; // Gupta General Store, debtor
const ok = (s: string) => console.log(`ok  ${s}`);

async function main() {
  const { db } = await import("../src/lib/db");
  const { parseAmount, resolveCounterparty } = await import("../src/khata/words");
  const { addDrafts, confirm, pendingForMe, respond } = await import("../src/khata/entries");
  const { udhaarBalances, khataPeriod } = await import("../src/khata/balances");
  const { reminderLink, sendReminder } = await import("../src/khata/settle");
  const { khataQuickReply } = await import("../src/khata/whatsapp");
  const { tapSig, tapSigOk } = await import("../src/khata/tap");
  const { qrSig } = await import("../src/lib/qr-sig");
  const { activeDemoMid } = await import("../src/lib/demo");
  const { dailySummary } = await import("../src/engine/queries");
  const voice = (await import("../src/app/api/khata/voice/route")).POST;

  // 1. Pure text helpers.
  const amounts: [string, number | null][] = [
    ["paanch sau cash mile", 500], ["dedh hazaar", 1500], ["dhai sau", 250], ["saade teen hazaar", 3500], ["sava do sau", 225],
    ["aaj 3400 cash aaya", 3400], ["3,400", 3400], ["3.5k", 3500], ["teen sau pachaas", 350],
    ["Priya 98765 43210 ko 300 udhaar", 300], ["+91 9876543210 wale ko 200 diye", 200], ["9876543210", null], ["500 300", null],
  ];
  for (const [t, want] of amounts) assert.equal(parseAmount(t), want, t);
  ok(`parseAmount: ${amounts.length} cases incl. Hindi number words; phone digits never read as rupees`);
  const shops = await db.merchant.findMany({ select: { id: true, business_name: true } });
  assert.deepEqual(resolveCounterparty("Gupta General Store", shops, [], C), { type: "MERCHANT", mid: D, name: "Gupta General Store" });
  assert.equal((resolveCounterparty("Gupta wale", shops, [], C) as { mid?: string }).mid, D);
  assert.equal(resolveCounterparty("sweets wale", shops, [], C)?.type, "AMBIGUOUS");
  assert.equal(resolveCounterparty("Priya", shops, ["Priya Sharma"], C)?.name, "Priya Sharma");
  ok("resolveCounterparty: 'Gupta wale' -> MID-0005, 'sweets wale' -> ambiguous, 'Priya' -> existing customer");
  if (process.env.TAP_SECRET) {
    assert.ok(tapSigOk(C, tapSig(C)) && !tapSigOk(C, qrSig(C)) && !tapSigOk(D, tapSig(C)));
    ok("tap sig: valid for its mid only; the shop QR's sig doesn't open the khata");
  }

  // Never touch the demo shop, a claimed shop, or whatever the demo phone is acting as.
  const live = await activeDemoMid();
  for (const mid of [C, D]) {
    const m = await db.merchant.findUniqueOrThrow({ where: { id: mid } });
    assert.ok(!m.is_demo && mid !== live && mid !== "MID-0001", `${mid} is the demo shop`);
    assert.equal(await db.phoneBinding.count({ where: { merchant_id: mid } }), 0, `${mid} is claimed; pick other shops`);
  }

  const start = new Date(Date.now() - 1000);
  const convsBefore = new Set((await db.conversation.findMany({ where: { merchant_id: { in: [C, D] } }, select: { id: true } })).map((c) => c.id));
  try {
    // 2. Extraction: two drafts, Gupta matched as a merchant.
    const before = await khataPeriod(C);
    const r = await addDrafts(C, "paanch sau cash mile aur Gupta General Store ko teen sau udhaar diya", "DASHBOARD");
    assert.equal(r.drafts.length, 2, JSON.stringify(r.drafts));
    const cash = r.drafts.find((d) => d.kind === "CASH_SALE");
    const ud = r.drafts.find((d) => d.kind === "UDHAAR_GIVEN");
    assert.equal(cash?.amount, 500);
    assert.equal(ud?.amount, 300);
    assert.deepEqual([ud?.counterparty.type, ud?.counterparty.mid], ["MERCHANT", D]);
    assert.equal(await db.khataEntry.count({ where: { id: { in: r.drafts.map((d) => d.id) }, status: "DRAFT" } }), 2);
    ok(`extract -> ${r.drafts.map((d) => d.label).join(" | ")} (both DRAFT)`);
    console.log(r.reply.split("\n").map((l) => `      ${l}`).join("\n"));

    // 3. Confirm: cash counts today, Gupta gets a pending mirror.
    const c = await confirm(C, r.drafts.map((d) => d.id));
    assert.equal(c.confirmed.length, 2);
    const after = await khataPeriod(C);
    assert.equal(after.cash.total - before.cash.total, 500);
    assert.equal(after.kamai - before.kamai, 500);
    const [mirror] = (await pendingForMe(D)).filter((e) => e.linked_entry_id === ud!.id);
    assert.ok(mirror && mirror.kind === "UDHAAR_TAKEN" && mirror.amount === 300 && mirror.counterparty_mid === C);
    const given = await db.khataEntry.findUniqueOrThrow({ where: { id: ud!.id } });
    assert.equal(given.linked_entry_id, mirror.id);
    assert.equal((await udhaarBalances(D)).find((b) => b.mid === C)?.waiting_my_ok, 300);
    ok(`confirm -> creditor cash +Rs 500 (kamai ${before.kamai} -> ${after.kamai}); Gupta has a PENDING Rs 300 payable, linked both ways`);

    // 4. Gupta says haan (the WhatsApp path: a bare "haan" with no drafts open answers the request).
    const reply = await khataQuickReply(D, "Haan");
    assert.ok(reply, "quick reply did not answer the request");
    assert.deepEqual((await db.khataEntry.findMany({ where: { id: { in: [given.id, mirror.id] } } })).map((e) => e.status), ["CONFIRMED", "CONFIRMED"]);
    assert.equal((await udhaarBalances(D)).find((b) => b.mid === C)?.dene, 300);
    ok(`Gupta "Haan" -> both CONFIRMED; reply: ${reply}`);

    // 5. Reminder link (sends are off, so it is mirrored only).
    const rem = await sendReminder(C, D);
    assert.equal(rem.amount, 300);
    assert.equal(rem.link, reminderLink(C, given.id));
    assert.match(rem.link, new RegExp(`/pay/${C}\\?s=${qrSig(C)}&u=${given.id}$`));
    assert.match(rem.text, /^Shree Ganesh Mishthan Bhandar se Rs 300 baaki hai\. Yahan pay karein: /);
    ok(`reminder -> "${rem.text}" (sent=${rem.sent})`);

    // 6. Pay through /api/pay with u: Rs 100, then more than is left, then the rest.
    const body = { mid: C, sig: qrSig(C), payer_name: "Gupta General Store", pin: "1111", u: given.id };
    const post = async (amount: number) => {
      const res = await fetch(`${process.env.CHECK_BASE_URL ?? "http://localhost:3204"}/api/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, amount, idem: crypto.randomUUID(), device: `check-khata-${crypto.randomUUID()}` }) });
      return { status: res.status, body: await res.json() };
    };
    const p1 = await post(100);
    assert.equal(p1.status, 200, JSON.stringify(p1));
    const row = await db.payment.findUniqueOrThrow({ where: { txn_ref: p1.body.txn_ref } });
    assert.equal(row.merchant_id, C);
    assert.equal(await db.khataSettlement.count({ where: { payment_id: row.id } }), 2);
    const left = async () => [(await udhaarBalances(C)).find((b) => b.mid === D)?.lene ?? 0, (await udhaarBalances(D)).find((b) => b.mid === C)?.dene ?? 0];
    assert.deepEqual(await left(), [200, 200]);
    ok(`paid Rs 100 -> payment ${row.txn_ref} in ${C}'s settlement.payments, 2 khata settlements; Rs 200 left on both sides`);
    const over = await post(300);
    assert.equal(over.status, 400, JSON.stringify(over));
    ok(`Rs 300 against Rs 200 left -> ${over.status} ${over.body.error}`);
    const p2 = await post(200);
    assert.equal(p2.status, 200, JSON.stringify(p2));
    assert.deepEqual(await left(), [0, 0]);
    const p3 = await post(50);
    assert.equal(p3.status, 409, JSON.stringify(p3));
    ok(`paid Rs 200 -> cleared on both sides; another payment on the link -> ${p3.status} ${p3.body.error}`);

    // 7. daily_summary: UPI next to the self-reported khata.
    const s = await dailySummary(C);
    assert.ok(s.khata.self_reported && s.khata.cash >= 500 && s.khata.udhaar.received_back >= 300 && s.khata.udhaar.given >= 300);
    assert.equal(s.khata.kamai_upi_plus_cash, s.successful_total + s.khata.cash);
    ok(`daily_summary -> UPI ${s.successful_total} + cash ${s.khata.cash} = ${s.khata.kamai_upi_plus_cash}; udhaar ${JSON.stringify(s.khata.udhaar)}`);

    // 8. Nahi: both sides DISPUTED. Written as a draft directly (no second model call).
    const d2 = await db.khataEntry.create({ data: { merchant_id: C, kind: "UDHAAR_GIVEN", amount: 70, counterparty_type: "MERCHANT", counterparty_name: "Gupta General Store", counterparty_mid: D, source: "DASHBOARD", entry_date: new Date(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) } });
    await confirm(C, [d2.id]);
    const no = await respond(D, false);
    assert.equal(no.status, "DISPUTED");
    const pair = await db.khataEntry.findMany({ where: { OR: [{ id: d2.id }, { linked_entry_id: d2.id }] } });
    assert.deepEqual(pair.map((e) => e.status), ["DISPUTED", "DISPUTED"]);
    assert.equal((await udhaarBalances(C)).find((b) => b.mid === D)?.disputed, 70);
    ok("Nahi -> both DISPUTED, shown as disputed on the creditor's side");

    // 9. The tap page's endpoint refuses a bad signature before any STT or model call.
    const f = new FormData();
    f.append("mid", C);
    f.append("sig", qrSig(C));
    f.append("text", "aaj 100 cash");
    assert.equal((await voice(new Request("http://local/api/khata/voice", { method: "POST", body: f }))).status, 401);
    ok("/api/khata/voice with the shop QR's sig -> 401");

    await new Promise((res) => setTimeout(res, 4000)); // let the after() notifications land before cleanup
  } finally {
    const entries = await db.khataEntry.findMany({ where: { merchant_id: { in: [C, D] }, created_at: { gte: start } }, select: { id: true } });
    const pays = await db.payment.findMany({ where: { merchant_id: C, payer_name: "Gupta General Store", created_at: { gte: start } }, select: { id: true } });
    const convs = await db.conversation.findMany({ where: { merchant_id: { in: [C, D] } }, select: { id: true } });
    await db.khataEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } }); // settlements cascade
    await db.outboxEvent.deleteMany({ where: { schema: "settlement", table: "payments", row_id: { in: pays.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
    const msgs = await db.message.deleteMany({ where: { conversation_id: { in: convs.map((c) => c.id) }, created_at: { gte: start } } });
    const traces = await db.traceEvent.deleteMany({ where: { created_at: { gte: start }, OR: [{ conversation_id: { in: convs.map((c) => c.id) } }, { name: { startsWith: "udhaar." } }] } });
    const fresh = convs.filter((c) => !convsBefore.has(c.id)).map((c) => c.id);
    if (fresh.length) await db.conversation.deleteMany({ where: { id: { in: fresh } } });
    console.log(`cleaned up ${entries.length} khata entries, ${pays.length} payments, ${msgs.count} messages, ${traces.count} trace events, ${fresh.length} new conversations`);
    await db.$disconnect();
  }
  console.log("check-khata: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
