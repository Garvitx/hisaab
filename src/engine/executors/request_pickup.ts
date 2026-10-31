import { close_subscription } from "./close_subscription";
import { schedule_pickup } from "./schedule_pickup";
import type { Executor } from "./common";

// Merchant asked to return the device: book the pickup and stop rent from today.
export const request_pickup: Executor = async (x) => {
  const pickup = await schedule_pickup(x);
  return [...pickup, ...(await close_subscription(x))];
};
