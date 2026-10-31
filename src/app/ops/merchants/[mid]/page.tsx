import type { Metadata } from "next";
import { Suspense } from "react";
import { MerchantDetail } from "@/components/merchant-detail";
import { MerchantQR } from "@/components/merchant-qr";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Merchant, Hisaab ops", description: "One merchant's ledgers across six systems." };

async function QR({ params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params;
  return <MerchantQR mid={mid} className="w-full lg:w-[340px]" />;
}

export default function Page({ params }: PageProps<"/ops/merchants/[mid]">) {
  return (
    <Suspense fallback={<Panel><Skeleton rows={8} /></Panel>}>
      <MerchantDetail
        params={params}
        qr={
          <Suspense fallback={<div className="size-80 rounded-(--radius-card) bg-paper-3" />}>
            <QR params={params} />
          </Suspense>
        }
      />
    </Suspense>
  );
}
