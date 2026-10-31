// Run: npx tsx src/components/live.check.ts
import assert from "node:assert/strict";
import { nextLine } from "./live";

const q1 = [{ pay: 100 }, { pay: 250 }];
assert.equal(nextLine(q1), "Paytm par ₹100 prapt hue");
assert.equal(nextLine(q1), "Paytm par ₹250 prapt hue");
assert.equal(nextLine(q1), null);

const q2 = [{ text: "refund" }, { pay: 100 }, { pay: 2500 }, { pay: 99900 }];
assert.equal(nextLine(q2), "Paytm par 3 payment, kul ₹1,02,500 prapt hue");
assert.deepEqual(q2, [{ text: "refund" }]);
console.log("announce batching ok");
