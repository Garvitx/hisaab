import type { Executor } from "./common";

// A warning with nothing to change in any ledger (card-testing burst, QR swapped):
// the notifier sends the message, so there is nothing to undo.
export const alert_merchant: Executor = async () => [];
