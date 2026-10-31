import * as settlement from "@/systems/settlement";
import { ids, type Executor } from "./common";

export const reverse_deduction: Executor = async (x) => {
  const want = ids(x.refs, "deduction_ids", "deduction_id");
  const rows = (await Promise.all(want.map(settlement.deduction))).filter((d) => d && d.merchant_id === x.merchant_id);
  const amount = rows.reduce((a, d) => a + d!.amount, 0);
  if (!amount) throw new Error("reverse_deduction: nothing to reverse");
  const credit = await settlement.addCredit({ merchant_id: x.merchant_id, amount, reason: `Refund of deduction ${rows.map((d) => d!.id).join(", ")}`, action_id: x.action_id });
  return [{ op: "credit.delete", id: credit.id }];
};
