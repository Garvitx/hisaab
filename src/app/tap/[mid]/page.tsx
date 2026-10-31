import type { Metadata } from "next";
import { Suspense } from "react";
import * as merchants from "@/systems/merchants";
import { tapSigOk } from "@/khata/tap";
import { TapPad } from "@/components/khata/tap-pad";
import { PayNotice } from "@/components/pay/pay-shell";

export const metadata: Metadata = { title: "Khata", description: "Bolkar likhiye: cash, kharcha, udhaar." };

// The NFC sticker on the counter opens this. A bad signature says nothing about any merchant.
async function Gate({ params, searchParams }: PageProps<"/tap/[mid]">) {
  const [{ mid }, sp] = await Promise.all([params, searchParams]);
  const sig = typeof sp.s === "string" ? sp.s : undefined;
  const m = tapSigOk(mid, sig) ? await merchants.get(mid) : null;
  if (!m) return <PayNotice title="Ye sticker valid nahi hai">Dukaan ke dashboard se naya sticker link lijiye.</PayNotice>;
  return <TapPad mid={m.id} sig={sig!} businessName={m.business_name} />;
}

export default function Page(props: PageProps<"/tap/[mid]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-6 h-72 w-full max-w-[430px] animate-pulse rounded-[var(--radius-card)] bg-paper" />}>
      <Gate {...props} />
    </Suspense>
  );
}
