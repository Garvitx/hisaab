import * as billing from "@/systems/billing";
import * as settlement from "@/systems/settlement";
import { ids, iso, type Executor, type Inverse } from "./common";

// Charges go REVERSED; only the ones already deducted are owed back as a credit.
export const reverse_charge: Executor = async (x) => {
  const rows = (await billing.charges(ids(x.refs, "charge_ids", "charge_id"))).filter((c) => c.merchant_id === x.merchant_id && c.status !== "REVERSED" && c.status !== "BLOCKED");
  if (!rows.length) throw new Error("reverse_charge: nothing to reverse");
  await billing.setCharges(rows.map((c) => c.id), { status: "REVERSED" });
  const inverse: Inverse = rows.map((c) => ({ op: "charge", id: c.id, status: c.status, notice_sent_at: iso(c.notice_sent_at) }));
  const owed = rows.filter((c) => c.status === "DEDUCTED").reduce((a, c) => a + c.amount, 0);
  if (owed) {
    const credit = await settlement.addCredit({ merchant_id: x.merchant_id, amount: owed, reason: `Reversed ${rows.length} charge(s): ${rows.map((c) => `${c.kind} ${c.period}`).join(", ")}`, action_id: x.action_id });
    inverse.push({ op: "credit.delete", id: credit.id });
  }
  return inverse;
};
