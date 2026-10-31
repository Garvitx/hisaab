import * as billing from "@/systems/billing";
import { ids, iso, type Executor } from "./common";

// Records that the merchant was told; the notifier sends the actual message.
export const send_warning: Executor = async (x) => {
  const rows = (await billing.charges(ids(x.refs, "charge_ids", "charge_id"))).filter((c) => c.merchant_id === x.merchant_id && !c.notice_sent_at);
  await billing.setCharges(rows.map((c) => c.id), { notice_sent_at: new Date() });
  return rows.map((c) => ({ op: "charge" as const, id: c.id, status: c.status, notice_sent_at: iso(c.notice_sent_at) }));
};
