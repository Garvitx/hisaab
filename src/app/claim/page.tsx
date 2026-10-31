import type { Metadata } from "next";
import { Suspense } from "react";
import { ClaimFlow } from "@/components/claim-flow";
import { ClaimAdmin } from "@/components/claim-admin";
import { injectTokenOk } from "@/components/inject-token";

export const metadata: Metadata = { title: "Claim a shop, Hisaab", description: "Make your WhatsApp number chat with Hisaab as one of the demo shops." };

async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { k } = await searchParams;
  return injectTokenOk(k) ? <ClaimAdmin k={k} /> : null;
}

export default function Page({ searchParams }: PageProps<"/claim">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-3xl">Claim a shop</h1>
        <p className="mt-1 text-ink-2">Pick a shop, confirm your number on WhatsApp, then chat with Hisaab as its owner.</p>
      </div>
      <p className="rounded-lg bg-warn-wash px-4 py-3 text-ink">
        Demo: your number will chat with Hisaab as this shop. No real money.
      </p>
      <ClaimFlow />
      <Suspense fallback={null}>
        <Admin searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
