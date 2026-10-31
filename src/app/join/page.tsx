import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { joinLink, joinSvg } from "@/components/join-qr";

export const metadata: Metadata = { title: "Join Hisaab", description: "Become a Paytm merchant for this demo: one WhatsApp message gets you a shop." };

export default async function Page() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 px-4 py-8 text-center">
      <div>
        <h1 className="text-3xl [overflow-wrap:break-word]">Become a Paytm merchant for this demo</h1>
        <p className="mt-2 text-ink-2">Send one WhatsApp message. You get a shop, its QR, and Hisaab as your saathi. No real money.</p>
      </div>
      <div role="img" aria-label="QR code that opens WhatsApp with JOIN HISAAB" className="aspect-square w-full max-w-72 rounded-(--radius-card) border border-rule bg-paper p-3 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: await joinSvg() }} />
      <a
        href={joinLink()}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-navy px-5 text-lg font-semibold text-navy-ink transition-colors duration-(--dur-micro) hover:bg-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <MessageCircle className="size-5" aria-hidden /> Open WhatsApp
      </a>
      <p className="text-ink-2">
        Want a particular shop?{" "}
        <Link href="/claim" className="rounded font-semibold text-sky-text hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          Pick one on the claim page
        </Link>
      </p>
    </main>
  );
}
