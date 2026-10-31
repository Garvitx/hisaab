import type { Metadata } from "next";
import { OpsOverview } from "@/components/ops-overview";
import { MeraHisaab } from "@/components/mera-hisaab";

export const metadata: Metadata = { title: "Hisaab live demo", description: "Merchant view and ops view side by side, scoreboard on top." };

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-[1760px] flex-1 flex-col px-4 py-4 sm:px-6">
      <OpsOverview variant="demo" left={<MeraHisaab mid="MID-0001" compact />} />
    </main>
  );
}
