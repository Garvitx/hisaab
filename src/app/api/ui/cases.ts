import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// Case list rows shared by /api/ui/overview and /api/ui/merchants/[mid].
export async function caseRows(where: Prisma.CaseWhereInput = {}, take = 60) {
  const [cases, merchants] = await Promise.all([
    db.case.findMany({
      where,
      orderBy: { opened_at: "desc" },
      take,
      include: {
        findings: { select: { origin: true, amount: true, verified: true, title: true } },
        actions: { select: { tier: true, status: true, amount: true, type: true } },
      },
    }),
    db.merchant.findMany({ select: { id: true, business_name: true } }),
  ]);
  const name = new Map(merchants.map((m) => [m.id, m.business_name]));
  return cases.map((c) => ({
    id: c.id,
    merchant_id: c.merchant_id,
    business_name: name.get(c.merchant_id) ?? c.merchant_id,
    source: c.source,
    status: c.status,
    summary: c.summary,
    opened_at: c.opened_at,
    resolved_at: c.resolved_at,
    detect_ms: c.detect_ms,
    amount: c.findings.reduce((a, f) => a + f.amount, 0),
    hunter: c.findings.some((f) => f.origin === "HUNTER"),
    rule: c.findings.some((f) => f.origin === "RULE"),
    tiers: [...new Set(c.actions.map((a) => a.tier))],
    pendingActions: c.actions.filter((a) => a.status === "PENDING" || a.status === "PROPOSED").length,
  }));
}
export type CaseRow = Awaited<ReturnType<typeof caseRows>>[number];
