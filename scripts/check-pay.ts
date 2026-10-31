// Run: tsx scripts/check-pay.ts. Drives POST /api/pay's handler directly (no dev server), then cleans up.
import assert from "node:assert/strict";
import { config } from "dotenv";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";

config({ path: ".env.local", quiet: true });

async function main() {
  // Dynamic imports: db.ts reads DATABASE_URL at load, which must happen after dotenv.
  const { POST } = await import("../src/app/api/pay/route");
  const { db } = await import("../src/lib/db");
  const { qrSig } = await import("../src/lib/qr-sig");
  // Node can't load the pay page's CSS module; stub it so the gate renders outside Next.
  createRequire(import.meta.url).extensions[".css"] = (m: NodeJS.Module) => void (m.exports = {});
  const { PayGate } = await import("../src/components/pay/pay-gate");

  const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
  const sig = qrSig("MID-0007");
  const good = { mid: "MID-0007", sig, payer_name: "Check Pay", amount: 101, pin: "1111" };
  const rows = (mid: string) => db.payment.count({ where: { payer_name: "Check Pay", merchant_id: mid } });
  const pay = async (over: Record<string, unknown>) => {
    const res = await POST(
      new Request("http://local/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ ...good, idem: crypto.randomUUID(), ...over }),
      }),
    );
    return { status: res.status, body: await res.json() };
  };

  const ids: string[] = [];
  try {
    // 1. Rejections, none of which may insert.
    for (const [label, over, want] of [
      ["bad sig", { sig: "0000000000000000" }, 401],
      ["MID-0007's sig on MID-0008", { mid: "MID-0008" }, 401],
      ["bad pin", { pin: "1234" }, 422],
      ["amount 0", { amount: 0 }, 400],
      ["amount 5001", { amount: 5001 }, 400],
      ["empty name", { payer_name: "  " }, 400],
    ] as const) {
      const r = await pay(over);
      assert.equal(r.status, want, `${label}: ${JSON.stringify(r)}`);
      console.log(`ok  ${label} -> ${r.status} ${r.body.error}`);
    }
    assert.equal((await rows("MID-0007")) + (await rows("MID-0008")), 0, "a rejected request inserted a row");
    console.log("ok  no rows for MID-0007 or MID-0008 after rejections");

    // 2. A good payment lands as a SUCCESS row with payer_name and a DEMO- order ref.
    const idem = crypto.randomUUID();
    const ok = await pay({ idem });
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.deepEqual(Object.keys(ok.body).sort(), ["amount", "business_name", "created_at", "txn_ref"]);
    assert.match(ok.body.txn_ref, /^\d{12}$/);
    const row = await db.payment.findUniqueOrThrow({ where: { txn_ref: ok.body.txn_ref } });
    ids.push(row.id);
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.payer_name, "Check Pay");
    assert.equal(row.payer_vpa, "check.pay@demo");
    assert.match(row.order_ref ?? "", /^DEMO-[0-9A-F]{8}$/);
    console.log(`ok  paid -> ${JSON.stringify(ok.body)} order_ref=${row.order_ref} vpa=${row.payer_vpa}`);

    // Replaying the same attempt returns the same payment, not a second one.
    const again = await pay({ idem });
    assert.equal(again.body.txn_ref, ok.body.txn_ref);
    console.log("ok  same idem key -> same txn_ref, no second row");

    // 3. A fresh attempt from the same IP inside 5 s is rate limited.
    const limited = await pay({});
    assert.equal(limited.status, 429, JSON.stringify(limited));
    console.log(`ok  second payment within 5 s -> 429 ${limited.body.error}`);
    assert.equal(await rows("MID-0007"), 1);
    assert.equal(await rows("MID-0008"), 0);

    // 5. The page: a bad or swapped signature shows only "not valid"; the real one shows the merchant.
    const html = async (mid: string, s: string | undefined) => renderToStaticMarkup(await PayGate({ mid, sig: s }));
    const m7 = await db.merchant.findUniqueOrThrow({ where: { id: "MID-0007" } });
    const m8 = await db.merchant.findUniqueOrThrow({ where: { id: "MID-0008" } });
    for (const [mid, s] of [["MID-0008", sig], ["MID-0007", "0000000000000000"], ["MID-0007", undefined]] as const) {
      const h = await html(mid, s);
      assert.match(h, /This QR is not valid/);
      assert.ok(!h.includes(m7.business_name) && !h.includes(m8.business_name), "invalid page leaked a merchant name");
    }
    assert.match(await html("MID-0007", sig), new RegExp(m7.business_name));
    console.log(`ok  page: bad/swapped sig -> "This QR is not valid" only; valid sig -> ${m7.business_name}`);

    // 4. The outbox trigger fired for the insert.
    const ev = await db.outboxEvent.findFirst({ where: { schema: "settlement", table: "payments", row_id: row.id, op: "INSERT" } });
    assert.ok(ev, "no outbox_events row for the payment");
    console.log(`ok  outbox_events #${ev.id} ${ev.schema}.${ev.table} ${ev.op} merchant=${ev.merchant_id}`);
  } finally {
    if (ids.length) {
      await db.outboxEvent.deleteMany({ where: { schema: "settlement", table: "payments", row_id: { in: ids } } });
      await db.payment.deleteMany({ where: { id: { in: ids } } });
      console.log(`cleaned up ${ids.length} payment row(s) and their outbox events`);
    }
    await db.$disconnect();
  }
  console.log("check-pay: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
