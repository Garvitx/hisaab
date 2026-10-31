import * as logistics from "@/systems/logistics";
import { mine, no, periodStart, subscriptionOf, sum, type Verifier } from "./common";

// refs: { subscription_id } or { device_id }
export const charge_after_return: Verifier = async (refs, ctx) => {
  const sub = await subscriptionOf(refs);
  if (!mine(sub, ctx)) return no("Subscription not found", refs);
  const device = await logistics.device(sub!.device_id);
  const at = (t: string) => device?.events.find((e) => e.type === t)?.at;
  const returned = at("RECEIVED_AT_WAREHOUSE") ?? at("PICKED_UP");
  if (!returned) return no("Device was never returned", refs);
  const wrong = sub!.charges.filter((c) => c.status !== "REVERSED" && periodStart(c.period) > returned);
  const out = { subscription_id: sub!.id, device_id: sub!.device_id, charge_ids: wrong.map((c) => c.id) };
  if (!wrong.length) return no("No charges after the return", out);
  return {
    ok: true, verdict: "WRONG", amount: sum(wrong), refs: out,
    title: `${device!.model === "EDC" ? "EDC" : "Soundbox"} rent charged after it was returned (${wrong.length} charges since ${returned.toISOString().slice(0, 10)})`,
  };
};
