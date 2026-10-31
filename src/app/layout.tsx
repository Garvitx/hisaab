import type { Metadata } from "next";
import { Suspense } from "react";
import { Anek_Devanagari, Mukta } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Both faces carry Devanagari and Latin, so Hindi and Hinglish set in the same voice.
const mukta = Mukta({ variable: "--font-mukta", subsets: ["latin", "devanagari"], weight: ["400", "600"], display: "swap" });
const anek = Anek_Devanagari({ variable: "--font-anek", subsets: ["latin", "devanagari"], display: "swap" });

export const metadata: Metadata = {
  title: "Hisaab",
  description: "An autonomous teammate that watches Paytm merchant ledgers, fixes what it may and explains every rupee.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mukta.variable} ${anek.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <Suspense fallback={<div className="h-14 bg-navy" />}>
          <SiteHeader />
        </Suspense>
        {children}
        <Toaster theme="light" position="bottom-right" richColors={false} />
      </body>
    </html>
  );
}
