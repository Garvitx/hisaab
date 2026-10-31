// The six rules of CLAUDE.md section 8, in order. Reads the policy row on every call so the dial is live.
import { db } from "@/lib/db";
import type { EvidenceSource, Tier } from "@/generated/prisma/client";

export type Kind = "notify" | "money" | "lending";

export async function decide(a: { kind: Kind; amount: number; verified: boolean; evidence_source: EvidenceSource }) {
  const p = (await db.policy.findUnique({ where: { id: 1 } })) ?? { auto_limit: 1000, approval_limit: 5000, lending_always_escalate: true };
  const out = (tier: Tier, rule: number, reason: string) => ({ tier, rule, reason, policy: p });
  if (a.kind === "notify") return out("AUTO", 1, "notify only, no money moves");
  if (a.kind === "lending" && p.lending_always_escalate) return out("ESCALATE", 2, "lending always goes to a human");
  const weak = !a.verified || a.evidence_source === "MERCHANT_CLAIM";
  if (a.amount <= p.auto_limit && !weak) return out("AUTO", 4, `₹${a.amount} ≤ auto limit ₹${p.auto_limit}`);
  if (a.amount <= p.approval_limit) return out("APPROVAL", weak ? 3 : 5, weak ? (a.verified ? "evidence is the merchant's word" : "finding not verified") : `₹${a.amount} ≤ approval limit ₹${p.approval_limit}`);
  return out("ESCALATE", 6, `₹${a.amount} over approval limit ₹${p.approval_limit}`);
}
