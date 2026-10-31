import type { Metadata } from "next";
import { OpsOverview } from "@/components/ops-overview";

export const metadata: Metadata = { title: "Hisaab ops", description: "Live scoreboard, case queue and agent trace for Paytm merchant ledgers." };

export default function Page() {
  return <OpsOverview />;
}
