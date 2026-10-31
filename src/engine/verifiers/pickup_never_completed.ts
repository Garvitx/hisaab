import * as billing from "@/systems/billing";
import * as logistics from "@/systems/logistics";
import { mine, no, owed, periodStart, str, sum, type Verifier } from "./common";

const DAY = 86_400_000;

// refs: { device_id } or { subscription_id }
export const pickup_never_completed: Verifier = async (refs, ctx) => {
  let device_id = str(refs, "device_id");
  const sid = str(refs, "subscription_id");
  if (!device_id && sid) device_id = (await billing.subscription(sid))?.device_id;
  const device = device_id ? await logistics.device(device_id) : null;
  if (!mine(device, ctx)) return no("Device not found", refs);
  const requested = device!.events.filter((e) => e.type === "PICKUP_REQUESTED").pop();
  if (!requested || requested.at.getTime() > Date.now() - 14 * DAY) return no("No pickup requested over 14 days ago", refs);
  if (device!.events.some((e) => (e.type === "PICKED_UP" || e.type === "RECEIVED_AT_WAREHOUSE") && e.at >= requested.at))
    return no("Pickup completed", refs);
  const sub = await billing.subscriptionForDevice(device!.id);
  const billingAfter = sub?.status === "ACTIVE" ? sub.charges.filter((c) => owed(c) && periodStart(c.period) > requested.at) : [];
  const out = { device_id: device!.id, subscription_id: sub?.id ?? null, charge_ids: billingAfter.map((c) => c.id) };
  if (!billingAfter.length) return no("Rent is not billing after the pickup request", out);
  // WARN, not WRONG: only the merchant can say whether the courier actually took it.
  return {
    ok: true, verdict: "WARN", amount: sum(billingAfter), refs: out,
    title: `Pickup requested ${requested.at.toISOString().slice(0, 10)} never completed, rent still billing`,
  };
};
