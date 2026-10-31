import * as logistics from "@/systems/logistics";
import { mine, no, owed, subscriptionOf, sum, type Verifier } from "./common";

// refs: { subscription_id } or { device_id }
export const charge_without_delivery: Verifier = async (refs, ctx) => {
  const sub = await subscriptionOf(refs);
  if (!mine(sub, ctx)) return no("Subscription not found", refs);
  const device = await logistics.device(sub!.device_id);
  if (device?.events.some((e) => e.type === "DELIVERED")) return no("Device was delivered", refs);
  const wrong = sub!.charges.filter(owed);
  const out = { subscription_id: sub!.id, device_id: sub!.device_id, charge_ids: wrong.map((c) => c.id) };
  if (!wrong.length) return no("No charges on the undelivered device", out);
  return {
    ok: true, verdict: "WRONG", amount: sum(wrong), refs: out,
    title: `Rent charged for a ${device?.model === "EDC" ? "EDC" : "Soundbox"} that was never delivered (${wrong.length} charges)`,
  };
};
