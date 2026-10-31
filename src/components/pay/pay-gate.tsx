import { qrSigOk } from "@/lib/qr-sig";
import * as merchants from "@/systems/merchants";
import { udhaarForPay } from "@/khata/settle";
import { PayFlow } from "./pay-flow";
import { PayNotice } from "./pay-shell";

// Outside page.tsx so scripts/check-pay.ts can render it. A bad signature says nothing about any merchant.
// u = an udhaar reminder link: amount and payer come prefilled; a settled or foreign entry just pays the shop.
export async function PayGate({ mid, sig, u }: { mid: string; sig: string | undefined; u?: string }) {
  const m = qrSigOk(mid, sig) ? await merchants.get(mid) : null;
  if (!m) return <PayNotice title="This QR is not valid" />;
  const udhaar = u ? await udhaarForPay(m.id, u) : null;
  return <PayFlow mid={m.id} sig={sig!} businessName={m.business_name} city={m.city} udhaar={udhaar} />;
}
