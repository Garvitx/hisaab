import type { Metadata } from "next";
import { Suspense } from "react";
import { MerchantsTable } from "@/components/merchants-table";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Merchants, Hisaab ops", description: "All merchants with their ledger health." };

export default function Page() {
  return (
    <Suspense fallback={<Panel><Skeleton rows={8} /></Panel>}>
      <MerchantsTable />
    </Suspense>
  );
}
