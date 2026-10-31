import type { Metadata } from "next";
import { Suspense } from "react";
import { OpsOverview } from "@/components/ops-overview";
import { MeraHisaab } from "@/components/mera-hisaab";
import { MerchantQR } from "@/components/merchant-qr";
import { JoinQR } from "@/components/join-qr";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Hisaab live demo", description: "Merchant view and ops view side by side, scoreboard on top." };

// The merchant on the left lives in the URL (?mid=), so the switcher is a plain navigation.
async function Merchant({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = (await searchParams).mid;
  const mid = typeof q === "string" && /^MID-\d{4}$/.test(q) ? q : "MID-0001";
  return <MeraHisaab key={mid} mid={mid} compact switchMode="demo" qr={<MerchantQR mid={mid} />} />;
}

export default function Page({ searchParams }: PageProps<"/demo">) {
  return (
    <main className="mx-auto flex w-full max-w-[1760px] flex-1 flex-col px-4 py-4 sm:px-6">
      <OpsOverview
        variant="demo"
        left={
          <Suspense fallback={<Panel><Skeleton rows={6} /></Panel>}>
            <Merchant searchParams={searchParams} />
          </Suspense>
        }
      />
      <div className="mt-4">
        <JoinQR />
      </div>
    </main>
  );
}
