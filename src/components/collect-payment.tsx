"use client";

import { QrCode } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inr, time } from "@/components/format";
import { cn } from "@/lib/utils";

type Pay = { id: string; amount: number; payer: string; status: string; created_at: string };

// Frames the pay agent's shop standee. The QR arrives as server-rendered children (it carries a signed URL).
// Payments come from the parent's poll, which also owns toasts and announcements, so nothing double-fires.
export function CollectPayment({
  businessName,
  city,
  payments,
  children,
}: {
  businessName: string;
  city: string;
  payments: Pay[];
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="lg" className="h-11 gap-2 px-4 text-base" />}>
        <QrCode className="size-5" aria-hidden />
        Collect payment
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-paper-2 p-0 sm:max-w-4xl">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center justify-center px-4 py-6 sm:px-8">
            <DialogTitle className="sr-only">Collect payment at {businessName}, {city}</DialogTitle>
            {children}
          </div>
          <div className="flex min-w-0 flex-col bg-paper md:rounded-r-xl">
            <div className="flex items-center justify-between border-b border-rule px-5 py-4 pr-12">
              <h2 className="text-lg">Payments received</h2>
              <span className="text-sm text-ink-3">Live</span>
            </div>
            {payments.length ? (
              <ul className="divide-y divide-rule" aria-live="polite">
                {payments.slice(0, 8).map((p) => (
                  <li key={p.id} className="row-in flex items-baseline justify-between gap-4 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{p.payer}</span>
                      <span className="num text-sm text-ink-3">{time(p.created_at)} IST</span>
                    </span>
                    <span className={cn("num shrink-0 text-xl font-semibold", p.status === "SUCCESS" ? "text-good" : "text-ink-3")}>
                      +{inr(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-ink-3">Waiting for the first scan.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
