// Run: npx tsx src/components/lab-spec.check.ts
import assert from "node:assert/strict";
import { verdict } from "./lab-spec";

const t0 = "2026-10-31T10:00:00.000Z";
const at = (s: number) => new Date(t0).getTime() + s * 1000;
const kase = (actions: { type: string; amount: number | null; tier: string; status: string }[], findings: { origin: string; check: string }[] = [], status = "RESOLVED") => ({ status, actions, findings });

assert.equal(verdict("rent_after_return", { merchant_id: "MID-0001", created_at: t0, case: null }, at(10)).state, "wait");
assert.equal(verdict("rent_after_return", { merchant_id: "MID-0001", created_at: t0, case: null }, at(120)).state, "fail");
assert.equal(verdict("rent_after_return", { merchant_id: "MID-0001", created_at: t0, case: kase([{ type: "reverse_charge", amount: 594, tier: "AUTO", status: "EXECUTED" }]) }).state, "pass");
assert.equal(verdict("rent_after_return", { merchant_id: "MID-0001", created_at: t0, case: kase([{ type: "reverse_charge", amount: 500, tier: "AUTO", status: "EXECUTED" }]) }).state, "fail");
assert.equal(verdict("rent_after_return", { merchant_id: "MID-0009", created_at: t0, case: kase([{ type: "reverse_charge", amount: 812, tier: "AUTO", status: "EXECUTED" }]) }).state, "pass");
assert.equal(verdict("rent_after_return", { merchant_id: "MID-0009", created_at: t0, case: kase([{ type: "reverse_charge", amount: 812, tier: "APPROVAL", status: "PENDING" }]) }).state, "wait");
assert.equal(verdict("duplicate_deduction", { merchant_id: "MID-0009", created_at: t0, case: kase([{ type: "reverse_deduction", amount: 135, tier: "AUTO", status: "EXECUTED" }], [{ origin: "RULE", check: "x" }]) }).state, "fail");
assert.equal(verdict("zombie_loan", { merchant_id: "MID-0009", created_at: t0, case: kase([{ type: "close_loan", amount: 0, tier: "ESCALATE", status: "PENDING" }], [], "ESCALATED") }).state, "pass");
assert.equal(verdict("slow_day", { merchant_id: "MID-0009", created_at: t0, case: null }, at(30)).state, "wait");
assert.equal(verdict("slow_day", { merchant_id: "MID-0009", created_at: t0, case: null }, at(61)).state, "pass");
assert.equal(verdict("slow_day", { merchant_id: "MID-0009", created_at: t0, case: kase([]) }, at(5)).state, "fail");
assert.equal(verdict("device_offline", { merchant_id: "MID-0001", created_at: t0, case: null }).state, "manual");
const alertCase = (check: string, status: string) => kase([{ type: "alert_merchant", amount: null, tier: "AUTO", status }], [{ origin: "RULE", check }]);
assert.equal(verdict("velocity_burst", { merchant_id: "MID-0009", created_at: t0, case: alertCase("payment_velocity", "EXECUTED") }).state, "pass");
assert.equal(verdict("velocity_burst", { merchant_id: "MID-0009", created_at: t0, case: alertCase("payments_stopped", "EXECUTED") }).state, "fail");
assert.equal(verdict("qr_swapped", { merchant_id: "MID-0009", created_at: t0, case: alertCase("payments_stopped", "EXECUTED") }).state, "pass");
assert.equal(verdict("qr_swapped", { merchant_id: "MID-0009", created_at: t0, case: alertCase("payments_stopped", "REJECTED") }).state, "fail");
console.log("lab verdicts ok");
