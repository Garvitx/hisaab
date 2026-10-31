import type { Metadata } from "next";
import { Suspense } from "react";
import { LabPanel } from "@/components/lab-panel";
import { injectTokenOk } from "@/components/inject-token";
import { ClaimQR } from "@/components/claim-qr";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Hisaab test lab", description: "Inject every anomaly and decoy and grade what Hisaab did." };

async function Gate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { k } = await searchParams;
  if (injectTokenOk(k))
    return (
      <div className="flex flex-col gap-4">
        <LabPanel k={k} />
        <ClaimQR />
      </div>
    );
  return (
    <div className="mx-auto max-w-md pt-10">
      <Panel>
        <div className="px-5 py-6">
          <h1 className="text-2xl">The test lab is locked</h1>
          <p className="mt-2 text-ink-2">Open it with the same key link as the chaos panel, or ask the presenter for it.</p>
        </div>
      </Panel>
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/lab">) {
  return (
    <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
      <Suspense fallback={<Panel><Skeleton rows={6} /></Panel>}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
