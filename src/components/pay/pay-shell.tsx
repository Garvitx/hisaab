import { TriangleAlert } from "lucide-react";
import "./pay.css";

// The warning strip lives in the shell, so every pay screen (invalid QR, amount, PIN, success) carries it.
export function PayShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`pay-app flex w-full flex-1 flex-col`}>
      <div role="alert" className="pay-strip">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
        <p>
          <strong>DEMO ONLY.</strong> No real money moves. Never enter your real UPI PIN here.
          <span className="pay-strip-hi" lang="hi-Latn">Yeh sirf demo hai, asli UPI PIN kabhi mat daaliye.</span>
        </p>
      </div>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">{children}</div>
    </main>
  );
}

export function PayNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="px-4 pt-10">
      <div className="rounded-[var(--radius-card)] bg-paper px-5 py-8 text-center shadow-[var(--shadow-card)]">
        <h1 className="text-2xl text-ink">{title}</h1>
        {children && <p className="mt-2 text-ink-2">{children}</p>}
      </div>
    </section>
  );
}
