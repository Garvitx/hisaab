import { qrSigOk } from "@/lib/qr-sig";
import * as merchants from "@/systems/merchants";
import { PayFlow } from "./pay-flow";
import { PayNotice } from "./pay-shell";

// Outside page.tsx so scripts/check-pay.ts can render it. A bad signature says nothing about any merchant.
export async function PayGate({ mid, sig }: { mid: string; sig: string | undefined }) {
  const m = qrSigOk(mid, sig) ? await merchants.get(mid) : null;
  if (!m) return <PayNotice title="This QR is not valid" />;
  return <PayFlow mid={m.id} sig={sig!} businessName={m.business_name} city={m.city} />;
}
