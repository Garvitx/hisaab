import { createHmac, timingSafeEqual } from "node:crypto";

// Static shop QR: /pay/<mid>?s=<sig>. The signature binds the QR to one merchant, so editing
// the mid in the URL breaks it. Fails closed when QR_SECRET is unset.
export function qrSig(mid: string, secret = process.env.QR_SECRET) {
  if (!secret) throw new Error("QR_SECRET missing");
  return createHmac("sha256", secret).update(mid).digest("hex").slice(0, 16);
}

export function qrSigOk(mid: string, sig: unknown, secret = process.env.QR_SECRET) {
  if (!secret || typeof sig !== "string" || sig.length !== 16) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(qrSig(mid, secret)));
}

export const payUrl = (mid: string) => `${process.env.APP_URL ?? ""}/pay/${mid}?s=${qrSig(mid)}`;
