import QRCode from "qrcode";
import { payUrl } from "@/lib/qr-sig";

// Server component: a Paytm-style shop standee for the merchant's static signed QR (CLAUDE.md 14b).
// Built server-side so QR_SECRET never reaches the browser; only the signed URL does.
export async function PayQR({ mid, businessName, city }: { mid: string; businessName: string; city?: string | null }) {
  // Hex, not tokens: qrcode needs literal colours. Navy #002E6E is --color-navy.
  const svg = await QRCode.toString(payUrl(mid), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });
  return (
    <figure className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[var(--radius-card)] bg-paper text-center shadow-[var(--shadow-card)]">
      <div className="bg-navy px-5 pb-4 pt-5">
        <h2 className="text-2xl text-navy-ink">{businessName}</h2>
        {city && <p className="mt-0.5 text-sm text-navy-ink-2">{city}</p>}
      </div>
      <div className="px-6 pb-2 pt-6">
        <div role="img" aria-label={`QR code to pay ${businessName}`} className="mx-auto aspect-square w-full max-w-[280px] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <figcaption className="border-t-4 border-sky px-5 py-4 text-lg font-semibold text-ink">Scan and pay with any name</figcaption>
    </figure>
  );
}
