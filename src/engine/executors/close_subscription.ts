import * as billing from "@/systems/billing";
import { ref, type Executor } from "./common";

export const close_subscription: Executor = async (x) => {
  const id = ref(x, "subscription_id");
  const device_id = ref(x, "device_id");
  const sub = id ? await billing.subscription(id) : device_id ? await billing.subscriptionForDevice(device_id) : null;
  if (!sub || sub.merchant_id !== x.merchant_id) throw new Error("close_subscription: subscription not found");
  if (sub.status === "CLOSED") return [];
  await billing.setSubscription(sub.id, { status: "CLOSED", closed_at: new Date() });
  return [{ op: "subscription", id: sub.id, status: sub.status, closed_at: null }];
};
