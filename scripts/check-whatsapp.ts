// Run: pnpm tsx scripts/check-whatsapp.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signatureOk, requestOk, messagesIn, samePhone } from "../src/channels/whatsapp.ts";

const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "P1" }, contacts: [{ wa_id: "919000000001", profile: { name: "Ramesh" } }], messages: [{ id: "w1", from: "919000000001", type: "text", text: { body: "hi" } }] } }] }] });
const hex = createHmac("sha256", "s3cret").update(raw).digest("hex");
assert.equal(signatureOk(raw, hex, "s3cret"), true);
assert.equal(signatureOk(raw, `sha256=${hex}`, "s3cret"), true);
assert.equal(signatureOk(raw + " ", hex, "s3cret"), false);
assert.equal(signatureOk(raw, hex, ""), false, "unset secret must fail closed");
assert.equal(signatureOk(raw, null, "s3cret"), false);
assert.equal(requestOk(raw, null, undefined, {}), false, "nothing configured must fail closed");
assert.equal(requestOk(raw, null, "p4th", { path: "p4th" }), true);
assert.equal(requestOk(raw, null, "wrong", { path: "p4th" }), false);
assert.equal(requestOk(raw, null, undefined, { path: "p4th" }), false);
assert.equal(requestOk(raw, hex, "p4th", { hmac: "s3cret", path: "p4th" }), true);
assert.equal(requestOk(raw, null, "p4th", { hmac: "s3cret", path: "p4th" }), false, "set hmac must still be checked");
const [m] = messagesIn(JSON.parse(raw));
assert.equal(m.contactName, "Ramesh");
assert.equal(m.phoneNumberId, "P1");
assert.equal(messagesIn({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }).length, 0);
assert.equal(samePhone("+91 90000 00001", "919000000001"), true);
assert.equal(samePhone("", ""), false);
console.log("whatsapp ok");
