// Run: ALLOW_LIVE_CHECKS=1 tsx scripts/check-join.ts. JOIN assignment, the 15-claim cap and the payment
// ping, against fake 9100000000xx phones; deletes every row it made. Keep CHAKRA_API_KEY empty to send nothing.
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (process.env.ALLOW_LIVE_CHECKS !== "1") {
  console.error("Refusing to run: this writes to the live demo database (it may reset it and message real phones). Set ALLOW_LIVE_CHECKS=1 to run anyway.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { join, MAX_ACTIVE } = await import("../src/lib/claims");
  const { onPayment } = await import("../src/agent/payments");
  const { joinText } = await import("../src/agent/join");
  const fake = (i: number) => `9100000000${String(i).padStart(2, "0")}`;
  const made: string[] = [];
  let payment: string | null = null;
  try {
    const first = await join(fake(11), "Check Join");
    assert.ok(first.ok && !first.already, "new phone gets a shop");
    made.push(fake(11));
    const b = await db.phoneBinding.findUniqueOrThrow({ where: { phone: fake(11) } });
    assert.equal(b.status, "ACTIVE");
    assert.equal(b.display_name, "Check Join");
    const m = await db.merchant.findUniqueOrThrow({ where: { id: b.merchant_id } });
    assert.ok(!m.is_demo && m.id !== "MID-0001", "never the demo shop");
    const again = await join(fake(11), "Check Join");
    assert.ok(again.ok && again.already && again.merchant_id === m.id, "JOIN again keeps the shop");
    const text = joinText(m, false, "Check Join");
    assert.ok(text.includes(m.business_name) && text.includes(m.city) && !/[ऀ-ॿ]/.test(text), "welcome names the shop, Latin only");

    // Fill to the cap with fake phones; the next one is refused.
    for (let i = 12; (await db.phoneBinding.count({ where: { status: "ACTIVE" } })) < MAX_ACTIVE; i++) {
      const r = await join(fake(i), null);
      assert.ok(r.ok, `filler ${i} joins`);
      made.push(fake(i));
    }
    const over = await join(fake(99), null);
    assert.ok(!over.ok && /le li gayi/.test(over.reason), "16th claim refused");
    assert.equal(await db.phoneBinding.count({ where: { phone: fake(99) } }), 0);
    const shops = await db.phoneBinding.findMany({ where: { status: "ACTIVE" }, select: { merchant_id: true } });
    assert.equal(new Set(shops.map((s) => s.merchant_id)).size, shops.length, "no shop handed out twice");

    // Payment ping: text (and voice when TTS works) mirrored to the shop's WA chat.
    const since = new Date();
    payment = (await db.payment.create({ data: { merchant_id: m.id, txn_ref: `79${Date.now()}`.slice(0, 12), amount: 123, payer_vpa: "check.join@demo", payer_name: "Check Join", order_ref: "DEMO-CHECKJOIN", status: "SUCCESS" } })).id;
    await onPayment(payment);
    const conv = await db.conversation.findFirstOrThrow({ where: { merchant_id: m.id, channel: "WA" }, orderBy: { opened_at: "desc" } });
    const out = await db.message.findMany({ where: { conversation_id: conv.id, created_at: { gte: since }, direction: "OUT" } });
    assert.ok(out.some((x) => x.type === "TEXT" && x.text === "₹123 received from Check Join"), "payment text mirrored");
    await db.message.deleteMany({ where: { id: { in: out.map((x) => x.id) } } });
    console.log(`ok: join on ${m.id}, cap at ${MAX_ACTIVE}, payment ping (${out.map((x) => x.type).join("+")})`);
  } finally {
    if (payment) await db.payment.delete({ where: { id: payment } });
    await db.phoneBinding.deleteMany({ where: { phone: { in: made } } });
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
