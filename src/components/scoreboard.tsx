import type { Scoreboard as S } from "@/lib/scoreboard";
import type { AiStats } from "@/lib/cost";
import { count, duration, inr, rupees2, seconds } from "@/components/format";

// The navy band: the five numbers the demo is scored on.
export function Scoreboard({ s }: { s: (S & { ai?: AiStats }) | null }) {
  const items: [string, string, string?][] = s
    ? [
        ["Anomalies injected", count(s.injected)],
        ["Caught", count(s.caught), s.injected ? `of ${count(s.injected)}` : undefined],
        ["Decoys ignored", count(s.decoysIgnored), s.decoys ? `of ${count(s.decoys)}` : undefined],
        ["Average detection", seconds(s.avgDetectMs)],
        ["Money recovered", inr(s.recovered)],
      ]
    : ["Anomalies injected", "Caught", "Decoys ignored", "Average detection", "Money recovered"].map((l) => [l, "–"]);
  return (
    <section aria-label="Scoreboard" className="rounded-(--radius-card) bg-navy text-navy-ink">
      <dl className="grid grid-cols-2 gap-y-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-navy-2">
        {items.map(([label, value, of]) => (
          <div key={label} className="min-w-0 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            <dt className="text-sm whitespace-nowrap text-navy-ink-2">{label}</dt>
            <dd className="num mt-0.5 text-3xl leading-tight font-semibold">
              {value}
              {of && <span className="ml-1.5 text-base font-normal text-navy-ink-2">{of}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {s?.ai && (
        <p className="num flex flex-wrap gap-x-6 gap-y-1 border-t border-navy-2 px-5 py-2 text-sm text-navy-ink-2">
          <span>Average resolution <b className="font-semibold text-navy-ink">{duration(s.ai.avgResolutionMs)}</b></span>
          <span>AI cost per case <b className="font-semibold text-navy-ink">{rupees2(s.ai.avgCostInr)}</b></span>
          <span>AI spend today <b className="font-semibold text-navy-ink">{rupees2(s.ai.spendTodayInr)}</b></span>
        </p>
      )}
    </section>
  );
}
