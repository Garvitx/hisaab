import type { Metadata } from "next";
import { Suspense } from "react";
import { MerchantDetail } from "@/components/merchant-detail";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Merchant, Hisaab ops", description: "One merchant's ledgers across six systems." };

export default function Page({ params }: PageProps<"/ops/merchants/[mid]">) {
  return (
    <Suspense fallback={<Panel><Skeleton rows={8} /></Panel>}>
      <MerchantDetail params={params} />
    </Suspense>
  );
}
