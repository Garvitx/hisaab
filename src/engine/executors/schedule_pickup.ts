import * as logistics from "@/systems/logistics";
import { ref, type Executor } from "./common";

export const schedule_pickup: Executor = async (x) => {
  const id = ref(x, "device_id");
  const device = id ? await logistics.device(id) : null;
  if (!device || device.merchant_id !== x.merchant_id) throw new Error("schedule_pickup: device not found");
  const e = await logistics.addEvent(device.id, "PICKUP_REQUESTED");
  return [{ op: "event.delete", id: e.id }];
};
