import type { Metadata } from "next";
import { Suspense } from "react";
import { CaseView } from "@/components/case-view";
import { Panel, Skeleton } from "@/components/bits";

export const metadata: Metadata = { title: "Case, Hisaab ops", description: "Findings, evidence, trace and actions for one case." };

export default function Page({ params }: PageProps<"/ops/cases/[id]">) {
  return (
    <Suspense fallback={<Panel><Skeleton rows={6} /></Panel>}>
      <CaseView params={params} />
    </Suspense>
  );
}
