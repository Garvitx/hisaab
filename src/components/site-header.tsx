"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { setSound, useSound } from "@/components/live";

type Role = "ops" | "merchant";
const DEMO_MID = "MID-0001";

const OPS_NAV = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/merchants", label: "Merchants" },
  { href: "/ops/policy", label: "Policy" },
  { href: "/ops/audit", label: "Audit" },
  { href: "/demo", label: "Demo" },
];

export function SiteHeader() {
  const path = usePathname();
  const router = useRouter();
  const sound = useSound();
  const [stored, setStored] = useState<Role>("ops");
  useEffect(() => {
    try {
      if (localStorage.getItem("hisaab:role") === "merchant") setStored("merchant");
    } catch {}
  }, []);
  if (path.startsWith("/pay")) return null; // the pay page has its own shell
  const role: Role = path.startsWith("/m/") ? "merchant" : path.startsWith("/ops") ? "ops" : stored;

  const pick = (r: Role) => {
    try {
      localStorage.setItem("hisaab:role", r);
    } catch {}
    setStored(r);
    router.push(r === "ops" ? "/ops" : `/m/${DEMO_MID}`);
  };

  const nav = role === "ops" ? OPS_NAV : [{ href: `/m/${DEMO_MID}`, label: "Mera Hisaab" }];
  const current = (href: string) => (href === "/ops" ? path === "/ops" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-(--z-sticky-nav) bg-navy text-navy-ink">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Hisaab home" className="shrink-0 rounded-md font-display text-xl font-semibold tracking-tight">
          Hisaab
        </Link>

        <div role="radiogroup" aria-label="View as" className="flex shrink-0 rounded-full bg-navy-2 p-0.5 text-sm">
          {(["ops", "merchant"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => pick(r)}
              className="h-8 rounded-full px-3 text-navy-ink-2 transition-colors duration-(--dur-micro) hover:text-navy-ink aria-checked:bg-sky aria-checked:text-sky-ink"
            >
              {r === "ops" ? "Paytm ops" : "Merchant"}
            </button>
          ))}
        </div>

        <nav aria-label="Main" className="flex min-w-0 flex-1 gap-1 overflow-x-auto text-sm [scrollbar-width:none]">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={current(n.href) ? "page" : undefined}
              className="flex h-9 shrink-0 items-center rounded-md px-2.5 text-navy-ink-2 transition-colors duration-(--dur-micro) hover:bg-navy-2 hover:text-navy-ink aria-[current=page]:bg-navy-2 aria-[current=page]:text-navy-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setSound(!sound)}
          aria-pressed={sound}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-navy-ink-2 transition-colors duration-(--dur-micro) hover:bg-navy-2 hover:text-navy-ink aria-pressed:text-navy-ink"
        >
          {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{sound ? "Sound on" : "Enable sound"}</span>
          <span className="sr-only sm:hidden">{sound ? "Sound on" : "Enable sound"}</span>
        </button>
      </div>
    </header>
  );
}
