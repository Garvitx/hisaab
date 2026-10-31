import QRCode from "qrcode";

// Server component: the pay link carries PAY_TOKEN, so the SVG is built here and the token never ships as JS.
export async function PayQR({ mid, businessName }: { mid: string; businessName: string }) {
  const url = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/pay/${mid}?k=${encodeURIComponent(process.env.PAY_TOKEN ?? "")}`;
  // Hex, not tokens: qrcode needs literal colours. Navy #002E6E is --color-navy.
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });
  return (
    <figure className="inline-flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-paper p-5 shadow-[var(--shadow-card)]">
      <div role="img" aria-label={`QR code to pay ${businessName}`} className="size-64 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="text-center text-lg font-semibold text-ink">Scan to pay {businessName}</figcaption>
    </figure>
  );
}
