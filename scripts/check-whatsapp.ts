// Run: node scripts/check-whatsapp.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signatureOk, messagesIn, samePhone } from "../src/channels/whatsapp.ts";

const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "P1" }, contacts: [{ wa_id: "919000000001", profile: { name: "Ramesh" } }], messages: [{ id: "w1", from: "919000000001", type: "text", text: { body: "hi" } }] } }] }] });
const hex = createHmac("sha256", "s3cret").update(raw).digest("hex");
assert.equal(signatureOk(raw, hex, "s3cret"), true);
assert.equal(signatureOk(raw, `sha256=${hex}`, "s3cret"), true);
assert.equal(signatureOk(raw + " ", hex, "s3cret"), false);
assert.equal(signatureOk(raw, hex, ""), false, "unset secret must fail closed");
assert.equal(signatureOk(raw, null, "s3cret"), false);
const [m] = messagesIn(JSON.parse(raw));
assert.equal(m.contactName, "Ramesh");
assert.equal(m.phoneNumberId, "P1");
assert.equal(messagesIn({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }).length, 0);
assert.equal(samePhone("+91 90000 00001", "919000000001"), true);
assert.equal(samePhone("", ""), false);
console.log("whatsapp ok");
