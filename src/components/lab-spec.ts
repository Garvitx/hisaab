// What each injection writes, what Hisaab should do and how the lab grades it (CLAUDE.md § 7, § 12).
export type Catcher = "RULE" | "HUNTER" | "CONCIERGE" | "DECOY";
type Act = { type: string; amount: number | null; tier: string; status: string };
type Fnd = { origin: string; check: string };
export type Result = {
  merchant_id: string;
  created_at: string;
  case: { status: string; findings: Fnd[]; actions: Act[] } | null;
};
export type Verdict = { state: "pass" | "fail" | "wait" | "manual"; label: string };

export type Spec = {
  writes: string;
  expected: string;
  catcher: Catcher;
  ask?: string;
  // Grades a result that has a case. Absent for decoys and concierge questions.
  grade?: (r: Result) => Verdict;
};

const DEMO = "MID-0001";
const DONE = new Set(["EXECUTED", "APPROVED"]);
const pass = (label: string): Verdict => ({ state: "pass", label });
const fail = (label: string): Verdict => ({ state: "fail", label });
const wait = (label: string): Verdict => ({ state: "wait", label });

// Passes on an executed action of `type` (and the demo amount when the target was the demo merchant).
function executed(type: string, demoAmount: number | null, hunter = false) {
  return (r: Result): Verdict => {
    const c = r.case!;
    if (hunter && !c.findings.some((f) => f.origin === "HUNTER")) return fail("Not found by the hunter");
    const a = c.actions.filter((x) => x.type === type);
    if (!a.length) return c.actions.length ? fail(`No ${type}`) : wait("Case open, deciding");
    const ok = a.find((x) => DONE.has(x.status));
    if (ok) {
      if (r.merchant_id === DEMO && demoAmount != null && ok.amount !== demoAmount) return fail(`Amount ${ok.amount}, expected ${demoAmount}`);
      return pass(`${type} executed`);
    }
    if (a.some((x) => x.status === "PENDING" || x.status === "PROPOSED")) return wait("Waiting for approval");
    return fail(`${type} ${a[0].status.toLowerCase()}`);
  };
}

export const SPEC: Record<string, Spec> = {
  rent_after_return: {
    writes: "Device returned 4 months ago, rent and late fees kept billing and were deducted",
    expected: "Auto-refund ₹594 (demo) and close the subscription, merchant gets a voice note",
    catcher: "RULE",
    grade: executed("reverse_charge", 594),
  },
  ghost_device: {
    writes: "Second Soundbox dispatched but never delivered, 3 months of rent deducted",
    expected: "Auto-refund ₹405 and close the subscription",
    catcher: "RULE",
    grade: executed("reverse_charge", 405),
  },
  silent_deduction: {
    writes: "₹2,800 of dues queued for the next settlement, no notice sent",
    expected: "Warn the merchant (auto, no money moves)",
    catcher: "RULE",
    grade: executed("send_warning", null),
  },
  orphan_dispute: {
    writes: "Payment with no order from an unknown VPA, ₹1,850 dispute deducted, merchant contested",
    expected: "Draft the evidence pack, wait for approval",
    catcher: "RULE",
    grade: (r) => {
      const a = r.case!.actions.find((x) => x.type === "contest_dispute");
      if (!a) return r.case!.actions.length ? fail("No contest_dispute") : wait("Case open, deciding");
      if (a.status === "REJECTED" || a.status === "UNDONE") return fail(`contest_dispute ${a.status.toLowerCase()}`);
      return a.tier === "APPROVAL" ? pass(a.status === "PENDING" ? "Drafted, awaiting approval" : "Approved") : fail(`Tier ${a.tier}, expected approval`);
    },
  },
  zombie_loan: {
    writes: "Loan settled with a one-time payment but still active, an EMI deducted after",
    expected: "Escalate to a human with the case file (lending)",
    catcher: "RULE",
    grade: (r) =>
      r.case!.status === "ESCALATED" || r.case!.actions.some((a) => a.tier === "ESCALATE")
        ? pass("Escalated")
        : r.case!.actions.length
          ? fail("Not escalated")
          : wait("Case open, deciding"),
  },
  duplicate_deduction: {
    writes: "The same rent charge deducted again in a later settlement",
    expected: "Hunter finds it, auto-reverse ₹135",
    catcher: "HUNTER",
    grade: executed("reverse_deduction", 135, true),
  },
  deduction_without_source: {
    writes: "₹299 FEE deduction with no source record",
    expected: "Hunter finds it, auto-reverse ₹299",
    catcher: "HUNTER",
    grade: executed("reverse_deduction", 299, true),
  },
  pickup_never_completed: {
    writes: "Pickup requested 2 months ago, never collected, rent still billing",
    expected: "Ask the merchant on WhatsApp first; after a yes, it goes to approval",
    catcher: "HUNTER",
    grade: (r) =>
      r.case!.findings.some((f) => f.origin === "HUNTER" && f.check === "pickup_never_completed")
        ? pass(r.case!.status === "AWAITING_MERCHANT" ? "Asking the merchant" : "Found by the hunter")
        : fail("Not found by the hunter"),
  },
  device_offline: {
    writes: "Soundbox last seen 3 hours ago",
    expected: "Answers with real device health and books a replacement",
    catcher: "CONCIERGE",
    ask: "Soundbox bol nahi raha",
  },
  pending_payment: {
    writes: "₹500 customer payment stuck in PENDING (or FAILED) a few minutes ago",
    expected: "Answers with the real status and UPI reference",
    catcher: "CONCIERGE",
    ask: "Customer bol raha ₹500 kat gaya, mere paas aaya kya?",
  },
  legit_late_fee: { writes: "Rent paid late, a ₹54 late fee, device active and delivered", expected: "Must NOT be flagged", catcher: "DECOY" },
  merchant_refund: { writes: "The merchant refunded a customer ₹500 themselves", expected: "Must NOT be flagged", catcher: "DECOY" },
  slow_day: { writes: "A Sunday settlement 70% below average", expected: "Must NOT be flagged", catcher: "DECOY" },
};

const DECOY_WINDOW_S = 60;
const DETECT_TIMEOUT_S = 90;

export function verdict(type: string, r: Result, now = Date.now()): Verdict {
  const s = SPEC[type];
  const age = Math.floor((now - new Date(r.created_at).getTime()) / 1000);
  if (!s) return r.case ? wait("Case opened") : wait("No expectation written");
  if (s.catcher === "DECOY") {
    if (r.case) return fail("False positive");
    return age >= DECOY_WINDOW_S ? pass("Correctly ignored") : wait(`Watching, ${DECOY_WINDOW_S - age}s left`);
  }
  if (s.catcher === "CONCIERGE") return r.case ? fail("Opened a case, expected none") : { state: "manual", label: "Ask on WhatsApp" };
  if (!r.case) return age >= DETECT_TIMEOUT_S ? fail(`Not detected in ${DETECT_TIMEOUT_S}s`) : wait("Detecting");
  return s.grade!(r);
}
