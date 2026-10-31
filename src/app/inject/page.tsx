import type { Metadata } from "next";
import { Suspense } from "react";
import { InjectPanel } from "@/components/inject-panel";
import { injectTokenOk } from "@/components/inject-token";
import { ClaimQR } from "@/components/claim-qr";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Hisaab chaos panel", description: "Inject anomalies into the mock ledgers and watch Hisaab catch them." };

async function Gate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { k } = await searchParams;
  if (injectTokenOk(k))
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <InjectPanel k={k} />
        <ClaimQR />
      </div>
    );
  return (
    <div className="mx-auto max-w-md pt-10">
      <Panel>
        <div className="px-5 py-6">
          <h1 className="text-2xl">This panel is locked</h1>
          <p className="mt-2 text-ink-2">
            The chaos panel needs the link with its key. Scan the QR code from the presenter, or ask them for the link.
          </p>
        </div>
      </Panel>
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/inject">) {
  return (
    <main className="w-full flex-1 px-4 py-6">
      <Suspense fallback={<Skeleton rows={4} />}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
