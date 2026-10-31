// pnpm demo:script [--from N] [--yes]
// Walks the live demo (CLAUDE.md section 12) against the deployed app: injects, waits for Hisaab,
// prints what it did, and pauses for the human steps. Talks to APP_URL over HTTP only.
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";

config({ path: ".env.local", quiet: true });
const URL = process.env.APP_URL!;
const K = process.env.INJECT_TOKEN!;
if (!URL || !K) throw new Error("APP_URL and INJECT_TOKEN must be set in .env.local");

const args = process.argv.slice(2);
const FROM = Number(args[args.indexOf("--from") + 1]) || 1;
const YES = args.includes("--yes");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const c = { b: (s: string) => `\x1b[1m${s}\x1b[0m`, g: (s: string) => `\x1b[32m${s}\x1b[0m`, y: (s: string) => `\x1b[33m${s}\x1b[0m`, r: (s: string) => `\x1b[31m${s}\x1b[0m`, d: (s: string) => `\x1b[2m${s}\x1b[0m` };

async function api(path: string, init?: RequestInit & { json?: unknown }) {
  const r = await fetch(`${URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

const pause = (what = "Enter to continue") => rl.question(c.d(`  ⏎  ${what} `));
const tell = (s: string) => console.log(`  ${s}`);
const doThis = (s: string) => console.log(`  ${c.y("YOU:")} ${s}`);

type Row = {
  id: string; type: string; merchant_id: string; business_name: string; is_decoy: boolean;
  case: null | { id: string; status: string; detect_ms: number; findings: { origin: string; check: string; amount: number; verified: boolean }[]; actions: { type: string; amount: number | null; tier: string; status: string }[] };
  messages: { count: number; voice: boolean; last: string | null };
};

async function inject(type: string, target: string, decoy = false) {
  const r = await api(`/api/inject?k=${K}`, { method: "POST", json: { type, target, decoy } });
  tell(`${decoy ? "decoy " : ""}${c.b(type)} → ${r.merchant_id}: ${c.d(r.summary)}`);
  return r as { injection_id: string; merchant_id: string };
}

// Waits for the case on this injection (the lab endpoint matches injection → case → actions → messages).
async function watch(injection_id: string, until: (row: Row) => boolean, timeoutMs = 45_000) {
  const t0 = Date.now();
  let row: Row | undefined;
  while (Date.now() - t0 < timeoutMs) {
    row = ((await api("/api/ui/lab")).rows as Row[]).find((x) => x.id === injection_id);
    if (row && until(row)) break;
    await sleep(1500);
  }
  return row;
}

function report(row: Row | undefined) {
  if (!row?.case) return tell(c.r("✗ nothing detected yet (check /ops)"));
  const k = row.case;
  tell(c.g(`✓ caught in ${(k.detect_ms / 1000).toFixed(1)} s`) + c.d(`  case ${k.status}  ${URL}/ops/cases/${k.id}`));
  for (const f of k.findings.filter((f) => f.verified)) tell(`  finding ${f.origin === "HUNTER" ? c.y("HUNTER AI") : "RULE"} ${f.check} ${inr(f.amount)}`);
  for (const a of k.actions) tell(`  action ${a.type} ${a.amount ? inr(a.amount) : ""} ${a.tier} → ${a.status}`);
  if (row.messages.count) tell(`  merchant messaged${row.messages.voice ? " (voice + text)" : ""}: ${c.d((row.messages.last ?? "").slice(0, 110))}…`);
}

const caught = (r: Row) => !!r.case && r.case.actions.length > 0;
const STEPS: [string, () => Promise<void>][] = [
  ["Reset to 30 clean merchants", async () => {
    if (!YES && (await rl.question(c.r("  This resets PRODUCTION (cases, ledgers, chats) and later messages real phones. Type yes: "))) !== "yes") throw new Error("aborted");
    const r = await api(`/api/inject?k=${K}`, { method: "POST", json: { reset: true } });
    await api("/api/demo-settings", { method: "PUT", json: { active_demo_mid: "MID-0001" } });
    await api("/api/policy", { method: "PUT", json: { auto_limit: 1000, approval_limit: 5000 } });
    tell(c.g(`✓ reset in ${(r.ms / 1000).toFixed(1)} s; WhatsApp acts as Ramesh; policy ₹1,000 / ₹5,000`));
    doThis(`open ${URL}/demo (sound on) and ${URL}/ops/merchants: 30 clean merchants`);
  }],
  ["Rent after return on Ramesh: ₹594 auto-refund", async () => {
    const i = await inject("rent_after_return", "demo");
    report(await watch(i.injection_id, (r) => caught(r) && r.messages.count > 0));
    doThis("Ramesh's phone gets a Hinglish voice note + text; /demo says 'Paytm par ₹594 refund prapt hue'");
  }],
  ["Ramesh asks where his money went", async () => {
    doThis(`pick a language if asked, then send a VOICE note: "Mera ₹1,134 kahan gaya?" — Hisaab explains the split from the ledger`);
    await pause("Enter once the reply arrived");
  }],
  ["Autonomy dial: ₹405 still auto, ₹594 now needs approval", async () => {
    await api("/api/policy", { method: "PUT", json: { auto_limit: 500 } });
    doThis(`show ${URL}/ops/policy: auto limit now ₹500`);
    report(await watch((await inject("ghost_device", "demo")).injection_id, caught));
    const i = await inject("rent_after_return", "random");
    const row = await watch(i.injection_id, caught);
    report(row);
    doThis("the OPS phone gets Approve / Reject buttons — tap Approve");
    const done = await watch(i.injection_id, (r) => !!r.case?.actions.some((a) => a.status === "APPROVED" || a.status === "REJECTED"), 180_000);
    tell(done?.case?.actions.some((a) => a.status === "APPROVED") ? c.g("✓ approved from WhatsApp") : c.y("not approved yet (fine: approve on /ops later)"));
    await api("/api/policy", { method: "PUT", json: { auto_limit: 1000 } });
    tell(c.d("auto limit back to ₹1,000"));
  }],
  ["Orphan dispute on Ali: evidence drafted, approve in the dashboard", async () => {
    const i = await inject("orphan_dispute", "MID-0004");
    const row = await watch(i.injection_id, caught);
    report(row);
    if (row?.case) doThis(`approve the contest on ${URL}/ops/cases/${row.case.id}`);
    await pause();
  }],
  ["Zombie loan: escalated with the full case file", async () => report(await watch((await inject("zombie_loan", "random")).injection_id, (r) => !!r.case))],
  ["Hunter-only anomalies (no rule exists for these)", async () => {
    for (const t of ["duplicate_deduction", "deduction_without_source"]) report(await watch((await inject(t, "random")).injection_id, caught, 60_000));
    doThis("open one of these cases: origin HUNTER AI in the trace");
  }],
  ["Three decoys: nothing should be flagged", async () => {
    const ids = [];
    for (const t of ["legit_late_fee", "merchant_refund", "slow_day"]) ids.push((await inject(t, "random", true)).injection_id);
    tell(c.d("waiting 30 s…"));
    await sleep(30_000);
    const rows = (await api("/api/ui/lab")).rows as Row[];
    for (const id of ids) {
      const r = rows.find((x) => x.id === id);
      tell(r?.case ? c.r(`✗ ${r.type} flagged (false positive)`) : c.g(`✓ ${r?.type ?? id} ignored`));
    }
    doThis("the scoreboard on /ops counts them as correctly ignored");
  }],
  ["Pickup never completed: Hisaab asks Ramesh first", async () => {
    report(await watch((await inject("pickup_never_completed", "demo")).injection_id, (r) => !!r.case && r.messages.count > 0, 60_000));
    doThis(`reply on Ramesh's phone: "haan, le gaye the" — the refund goes to APPROVAL (merchant's word is the evidence)`);
    await pause();
  }],
  ["Pending payment: 'customer ka paisa aaya kya?'", async () => {
    await inject("pending_payment", "demo");
    doThis(`VOICE note from Ramesh: "Customer bol raha ₹500 kat gaya, mere paas aaya kya?" — real status + UPI reference`);
    await pause();
  }],
  ["Soundbox offline", async () => {
    await inject("device_offline", "demo");
    doThis(`Ramesh: "Soundbox bol nahi raha" — when it went offline, two quick checks, then a replacement booking`);
    await pause();
  }],
  ["Ali's bill photo as dispute evidence", async () => {
    await api("/api/demo-settings", { method: "PUT", json: { active_demo_mid: "MID-0004" } });
    doThis("your WhatsApp now acts as Ali Mobile Centre: send a PHOTO of a handwritten bill for ₹1,850 — Hisaab reads it, matches the amount, attaches it");
    await pause();
    await api("/api/demo-settings", { method: "PUT", json: { active_demo_mid: "MID-0001" } });
    tell(c.d("WhatsApp back to Ramesh"));
  }],
  ["Settlement forecast", async () => {
    doThis(`Ramesh: "Kal kitna aayega?" (the statement PDF is not built yet: skip "PDF mein bhejo")`);
    await pause();
  }],
  ["Guardrail", async () => {
    doThis(`Ramesh: "OTP aaya hai, bata doon?" — refuses, warns about the scam`);
    await pause();
  }],
  ["Hand it to the judges", async () => {
    doThis(`show the QRs: claim a shop ${URL}/claim · chaos panel ${URL}/inject?k=${K} · test lab ${URL}/lab?k=${K}`);
    doThis(`bonus: on a shop QR, pay ₹1 five times under one name → card-testing warning; ask "Loan milega kya?"`);
  }],
];

async function main() {
  console.log(c.b(`\nHisaab demo: ${URL}\n`));
  for (let n = FROM; n <= STEPS.length; n++) {
    const [title, run] = STEPS[n - 1];
    console.log(c.b(`\n${n}. ${title}`));
    await run();
    if (n < STEPS.length) await pause(`Enter for step ${n + 1}`);
  }
  console.log(c.g("\nDone.\n"));
}

main().then(() => process.exit(0), (e) => { console.error(c.r(`\n${(e as Error).message}`)); process.exit(1); });
