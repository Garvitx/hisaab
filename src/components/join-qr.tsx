import QRCode from "qrcode";

// wa.me link that opens a chat with Hisaab prefilled "JOIN HISAAB"; sending it assigns a free shop.
export const joinLink = () => `https://wa.me/${String(process.env.AGENT_WA_NUMBER ?? "").replace(/\D/g, "")}?text=${encodeURIComponent("JOIN HISAAB")}`;

// Hex, not tokens: qrcode needs literal colours. Navy #002E6E is --color-navy.
export const joinSvg = () => QRCode.toString(joinLink(), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#002E6E", light: "#FFFFFF" } });

// Server component: the /demo card the host puts on screen for the room.
export async function JoinQR() {
  return (
    <section className="flex flex-col items-center gap-4 rounded-(--radius-card) border border-rule bg-paper p-5 text-center sm:flex-row sm:text-left">
      <div role="img" aria-label="QR code to become a merchant on WhatsApp" className="size-44 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: await joinSvg() }} />
      <div>
        <h2 className="text-xl">Become a merchant</h2>
        <p className="mt-1 max-w-[42ch] text-ink-2">Scan, send the message, and your WhatsApp gets a demo shop with its own QR. Payments to it ping your phone.</p>
      </div>
    </section>
  );
}
