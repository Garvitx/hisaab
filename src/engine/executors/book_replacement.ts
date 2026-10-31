import * as logistics from "@/systems/logistics";
import { ref, type Executor } from "./common";

export const book_replacement: Executor = async (x) => {
  const id = ref(x, "device_id");
  const device = id ? await logistics.device(id) : null;
  if (!device || device.merchant_id !== x.merchant_id) throw new Error("book_replacement: device not found");
  const r = await logistics.bookReplacement(device.id, x.merchant_id, ref(x, "reason") ?? "Device not working");
  return [{ op: "replacement", id: r.id, status: "CANCELLED" }];
};
