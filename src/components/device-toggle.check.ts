// Run: npx tsx src/components/device-toggle.check.ts
import assert from "node:assert/strict";
import { deviceState } from "./device-toggle";

const e = (type: string, d: string) => ({ type, at: `2026-${d}T00:00:00Z` });
assert.equal(deviceState([e("DISPATCHED", "05-01"), e("DELIVERED", "05-03")]), "in_shop");
assert.equal(deviceState([e("DISPATCHED", "08-01")]), "never_delivered");
assert.equal(deviceState([e("DELIVERED", "05-03"), e("PICKED_UP", "06-20"), e("RECEIVED_AT_WAREHOUSE", "06-25")]), "returned");
assert.equal(deviceState([e("DELIVERED", "05-03"), e("PICKUP_REQUESTED", "08-01")]), "in_shop");
assert.equal(deviceState([e("DELIVERED", "05-03"), e("PICKED_UP", "06-20"), e("DELIVERED", "07-01")]), "in_shop"); // redelivered
console.log("device state ok");
