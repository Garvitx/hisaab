import QRCode from "qrcode";

// Server component: a QR for the public /claim page, for the host to show judges.
export async function ClaimQR() {
  const url = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/claim`;
  // Hex, not tokens: qrcode needs literal colours. Navy #002E6E is --color-navy.
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });
  return (
    <section className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-rule bg-paper p-5 text-center sm:flex-row sm:text-left">
      <div role="img" aria-label="QR code to claim a shop" className="size-48 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div>
        <h2 className="text-xl">Claim a shop</h2>
        <p className="mt-1 max-w-[40ch] text-ink-2">Judges scan this to make their own WhatsApp number chat with Hisaab as a merchant.</p>
        <p className="num mt-2 text-sm text-ink-3">{url}</p>
      </div>
    </section>
  );
}
