import { qrSig, qrSigOk } from "@/lib/qr-sig";

// The NFC sticker's URL: /tap/<mid>?s=<sig>, sig = first 16 hex of HMAC-SHA256(mid, TAP_SECRET).
// Its own secret, so a shop QR (public, on the counter) never opens the khata. Fails closed when unset:
// qr-sig's default parameter would otherwise fall back to QR_SECRET.
const secret = () => {
  const s = process.env.TAP_SECRET;
  if (!s) throw new Error("TAP_SECRET missing");
  return s;
};
export const tapSig = (mid: string) => qrSig(mid, secret());
export const tapSigOk = (mid: string, sig: unknown) => !!process.env.TAP_SECRET && qrSigOk(mid, sig, process.env.TAP_SECRET);
export const tapUrl = (mid: string) => `${process.env.APP_URL ?? ""}/tap/${mid}?s=${tapSig(mid)}`;
