// Phase 0 hook: called after every shop-QR payment lands. The JOIN builder implements the
// WhatsApp text + Soundbox voice note to a claimed phone here.
export async function onPayment(_payment_id: string): Promise<void> {}
