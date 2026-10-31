import Link from "next/link";

const DOORS = [
  { href: "/demo", title: "Live demo", text: "Merchant and ops side by side, scoreboard on top." },
  { href: "/ops", title: "Paytm ops", text: "The case queue, live trace and approvals." },
  { href: "/m/MID-0001", title: "Mera Hisaab", text: "Ramesh Kirana Store's statement and WhatsApp chat." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-4xl sm:text-5xl">Every rupee, explained</h1>
        <p className="mt-3 max-w-[56ch] text-lg text-ink-2">
          Hisaab watches merchant ledgers, fixes what it is allowed to and tells the merchant on WhatsApp.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {DOORS.map((d, i) => (
          <li key={d.href}>
            <Link
              href={d.href}
              className={`flex h-full flex-col gap-1 rounded-(--radius-card) border px-4 py-4 transition-colors duration-(--dur-micro) ${
                i === 0 ? "border-navy bg-navy text-navy-ink hover:bg-navy-2" : "border-rule bg-paper hover:border-sky"
              }`}
            >
              <span className="font-display text-lg font-semibold">{d.title}</span>
              <span className={i === 0 ? "text-navy-ink-2" : "text-ink-2"}>{d.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
