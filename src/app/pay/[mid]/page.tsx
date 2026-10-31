import type { Metadata } from "next";
import { Suspense } from "react";
import { PayGate } from "@/components/pay/pay-gate";
import { PayShell } from "@/components/pay/pay-shell";

export const metadata: Metadata = { title: "Pay merchant", description: "Demo payment page. No real money." };

async function Gate({ params, searchParams }: PageProps<"/pay/[mid]">) {
  const [{ mid }, sp] = await Promise.all([params, searchParams]);
  return <PayGate mid={mid} sig={typeof sp.s === "string" ? sp.s : undefined} u={typeof sp.u === "string" ? sp.u : undefined} />;
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
