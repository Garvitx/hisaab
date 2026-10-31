import type { Metadata } from "next";
import { Suspense } from "react";
import { MeraHisaab } from "@/components/mera-hisaab";
import { MerchantQR } from "@/components/merchant-qr";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Mera Hisaab", description: "Har settlement, har katauti, saaf saaf." };

async function Body({ params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params;
  return <MeraHisaab mid={mid} qr={<MerchantQR mid={mid} />} />;
}

export default function Page({ params }: PageProps<"/m/[mid]">) {
  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">
      <Suspense fallback={<Panel><Skeleton rows={6} /></Panel>}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
