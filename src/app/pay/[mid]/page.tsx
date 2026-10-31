import type { Metadata } from "next";
import { Suspense } from "react";
import { timingSafeEqual } from "node:crypto";
import * as merchants from "@/systems/merchants";
import { PayFlow } from "@/components/pay/pay-flow";
import { PayShell, PayNotice } from "@/components/pay/pay-shell";

export const metadata: Metadata = { title: "Pay merchant", description: "Demo payment page. No real money." };

// Same fail-closed check as POST /api/pay: no PAY_TOKEN set means locked.
const ok = (k: string | undefined, want = process.env.PAY_TOKEN) =>
  !!want && !!k && k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));

async function Gate({ params, searchParams }: PageProps<"/pay/[mid]">) {
  const [{ mid }, sp] = await Promise.all([params, searchParams]);
  const k = typeof sp.k === "string" ? sp.k : undefined;
  if (!ok(k))
    return <PayNotice title="This pay link is locked">Scan the QR code on the demo screen to open the full link.</PayNotice>;
  const m = await merchants.get(mid);
  if (!m) return <PayNotice title="Merchant not found">This QR code points to a merchant that does not exist.</PayNotice>;
  return <PayFlow mid={m.id} k={k!} businessName={m.business_name} city={m.city} />;
}

export default function Page(props: PageProps<"/pay/[mid]">) {
  return (
    <PayShell>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-paper" />}>
        <Gate {...props} />
      </Suspense>
    </PayShell>
  );
}
