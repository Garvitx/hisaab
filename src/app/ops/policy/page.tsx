import type { Metadata } from "next";
import { PolicyDial } from "@/components/policy-dial";

export const metadata: Metadata = { title: "Policy, Hisaab ops", description: "How much Hisaab may fix on its own." };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl">Policy</h1>
      <PolicyDial />
    </div>
  );
}
