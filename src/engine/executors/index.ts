import { Prisma } from "@/generated/prisma/client";
import * as billing from "@/systems/billing";
import * as disputes from "@/systems/disputes";
import * as logistics from "@/systems/logistics";
import * as settlement from "@/systems/settlement";
import type { Executor, Inverse } from "./common";
import { reverse_charge } from "./reverse_charge";
import { reverse_deduction } from "./reverse_deduction";
import { close_subscription } from "./close_subscription";
import { schedule_pickup } from "./schedule_pickup";
import { contest_dispute } from "./contest_dispute";
import { send_warning } from "./send_warning";
import { book_replacement } from "./book_replacement";
import { request_pickup } from "./request_pickup";

export type { ExecInput, Executor, Inverse, Step } from "./common";

export const executors = {
  reverse_charge, reverse_deduction, close_subscription, schedule_pickup,
  contest_dispute, send_warning, book_replacement, request_pickup,
} satisfies Record<string, Executor>;

export type ActionType = keyof typeof executors;

// Steps are undone last-first, so a credit goes before the charge it paid for.
// ponytail: no transaction around the steps; wrap in db.$transaction if a half-undo ever shows up.
export async function runInverse(inverse: Inverse) {
  for (const s of [...inverse].reverse()) {
    if (s.op === "charge") await billing.setCharge(s.id, { status: s.status, notice_sent_at: s.notice_sent_at ? new Date(s.notice_sent_at) : null });
    else if (s.op === "credit.delete") await settlement.deleteCredit(s.id);
    else if (s.op === "subscription") await billing.setSubscription(s.id, { status: s.status, closed_at: s.closed_at ? new Date(s.closed_at) : null });
    else if (s.op === "event.delete") await logistics.deleteEvent(s.id);
    else if (s.op === "dispute") await disputes.set(s.id, { status: s.status, response_text: s.response_text, evidence: s.evidence == null ? Prisma.DbNull : (s.evidence as Prisma.InputJsonValue) });
    else if (s.op === "replacement") await logistics.setReplacement(s.id, s.status);
  }
}
