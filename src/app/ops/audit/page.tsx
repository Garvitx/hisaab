import type { Metadata } from "next";
import { AuditTable } from "@/components/audit-table";

export const metadata: Metadata = { title: "Audit, Hisaab ops", description: "Every action, who decided it and where." };

export default function Page() {
  return <AuditTable />;
}
