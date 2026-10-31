import { ShieldAlert } from "lucide-react";

// The permanent banner sits in the shell, so every pay screen (locked, flow, success) carries it.
export function PayShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="w-full flex-1 bg-paper-2">
      <div className="mx-auto w-full max-w-[420px] px-4 pb-10 pt-3">
        <p role="note" className="mb-3 flex items-start gap-2 rounded-xl bg-warn-wash px-3 py-2.5 text-sm leading-snug text-warn">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Demo only.</strong> No real money. Never enter your real UPI PIN.
          </span>
        </p>
        {children}
      </div>
    </main>
  );
}

export function PayNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-paper px-5 py-6 shadow-[var(--shadow-card)]">
      <h1 className="text-2xl text-ink">{title}</h1>
      <p className="mt-2 text-ink-2">{children}</p>
    </section>
  );
}
