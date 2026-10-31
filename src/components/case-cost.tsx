import type { CaseDetail } from "@/app/api/ui/cases/[id]/route";
import { count, duration, rupees2, type Json } from "@/components/format";

type C = Json<CaseDetail>;
const ROLE: Record<string, string> = { CONCIERGE: "Concierge", HUNTER: "Hunter", NOTIFIER: "Notifier", ROOT_CAUSE: "Root cause", KHATA: "Khata" };

// "Resolved in 4.2 s · AI cost ₹1.10", with the per-role / per-model calls behind a disclosure.
export function CaseCost({ c }: { c: C }) {
  const ms = c.resolution_ms ?? (c.resolved_at ? new Date(c.resolved_at).getTime() - new Date(c.opened_at).getTime() : null);
  const time = c.status === "RESOLVED" ? `Resolved in ${duration(ms)}` : `Open for ${duration(Date.now() - new Date(c.opened_at).getTime())}`;
  const rows = [
    ...c.cost.llm.map((r) => ({
      key: `${r.role}:${r.model}`, who: ROLE[r.role] ?? r.role, what: r.model, calls: r.calls,
      size: `${count(r.input_tokens + r.cache_read_tokens + r.cache_write_tokens)} in · ${count(r.output_tokens)} out`,
      cache: r.cache_read_tokens ? `${count(r.cache_read_tokens)} cached` : "", inr: r.cost_inr,
    })),
    ...c.cost.speech.map((r) => ({
      key: r.kind, who: r.kind === "STT" ? "Speech to text" : "Text to speech", what: "Sarvam", calls: r.calls,
      size: r.kind === "STT" ? `${r.seconds.toFixed(1)} s audio` : `${count(r.characters)} chars`, cache: "", inr: r.cost_inr,
    })),
  ];
  const calls = rows.reduce((a, r) => a + r.calls, 0);
  return (
    <details className="group mt-3 w-fit max-w-full text-sm">
      <summary className="cursor-pointer rounded font-semibold text-ink">
        <span className="num">{time}</span>
        <span className="mx-2 text-ink-3" aria-hidden>·</span>
        <span className="num">AI cost {rupees2(c.ai_cost_inr ?? 0)}</span>
        <span className="ml-2 font-normal text-sky-text">{calls ? `${calls} AI call${calls === 1 ? "" : "s"}` : "no AI calls"}</span>
      </summary>
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-md bg-paper-2">
          <table className="w-full min-w-[34rem] text-left">
            <thead className="text-ink-3">
              <tr>
                {["Role", "Model", "Calls", "Tokens / usage", "Cost"].map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-1.5 font-normal ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5 font-semibold text-ink">{r.who}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-ink-2">{r.what}</td>
                  <td className="num px-3 py-1.5 text-right">{r.calls}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-2">
                    {r.size}
                    {r.cache && <span className="block text-xs text-ink-3">{r.cache}</span>}
                  </td>
                  <td className="num px-3 py-1.5 text-right font-semibold">{rupees2(r.inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
