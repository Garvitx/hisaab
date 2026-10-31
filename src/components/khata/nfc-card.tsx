import QRCode from "qrcode";
import { tapUrl } from "@/khata/tap";
import { NfcWrite } from "./nfc-write";

// Server-only: the tap URL is signed with TAP_SECRET here, so the secret never reaches the browser.
export async function NfcCard({ mid }: { mid: string }) {
  let url: string;
  try {
    url = tapUrl(mid);
  } catch {
    return <p className="px-4 py-3 text-sm text-ink-3">NFC sticker ke liye TAP_SECRET set kijiye.</p>;
  }
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
      <div role="img" aria-label="Khata tap page ka QR" className="kh-qr max-w-[160px]" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="min-w-0">
        <p className="text-ink-2">Counter par sticker lagaiye. Phone lagate hi khata khulega, bolkar likhiye.</p>
        <a href={url} className="mt-1 block truncate text-sm text-sky-text underline underline-offset-2">{url}</a>
        <NfcWrite url={url} />
      </div>
    </div>
  );
}
