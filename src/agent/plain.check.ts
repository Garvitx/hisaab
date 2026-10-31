import assert from "node:assert/strict";
import { plain } from "./concierge";
assert.equal(plain("kul *₹3,321* aayega."), "kul ₹3,321 aayega.");
assert.equal(plain("**Kal ka settlement:** ₹2,916"), "Kal ka settlement: ₹2,916");
assert.equal(plain("## Hisaab\n- a"), "Hisaab\n- a");
assert.equal(plain("2*3 = 6"), "2*3 = 6");
console.log("plain ok");
