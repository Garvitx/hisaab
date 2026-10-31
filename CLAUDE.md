@AGENTS.md

# Hisaab: build spec for Claude Code

Hisaab is an autonomous AI teammate for Paytm merchant support. Anomalies get injected into mock Paytm ledgers, live. Hisaab detects them within seconds, works out what went wrong, fixes what it is allowed to fix, asks a human for the rest, and tells the merchant on WhatsApp by voice or text. Built solo in one day for the Paytm Build for India AI Hackathon (Track 3: Autonomous AI Teammates), 31 Oct 2026.

Read this whole file before writing code. When something here conflicts with your instincts, this file wins.

---

## 1. Non-negotiable rules

1. **The LLM never produces a rupee amount that gets written.** Every amount that touches a ledger comes from a verified finding computed by `src/engine`. Action tools take a `finding_id`, never an amount.
2. **Paytm schemas are reachable only through `src/systems/*`.** No cross-schema joins in agent code. The agent reaches data only through tools.
3. **The agent must never read `hisaab.injections`.** That table exists only for the detection scoreboard. Reading it would be cheating.
4. **Every agent step writes a `trace_events` row**, including thoughts summary, tool call, tool result, policy decision and message sent. The dashboard renders this live.
5. **Every executed action stores its inverse** so Undo always works.
6. **No auth.** Use a role switcher in the header (Paytm ops / Merchant). The inject panel uses a shared token in the URL.
7. **No secrets or phone numbers in code.** Everything comes from env.
8. **TypeScript everywhere.** Next.js App Router, Prisma, Neon Postgres, deployed on Vercel.
9. **Webhooks ack in under 200 ms.** Verify, persist, return 200, then do the work in `after()`.

---

## 2. Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript on Vercel |
| DB | Neon Postgres, 7 schemas, Prisma with multi-schema support |
| UI | Tailwind + shadcn/ui, Paytm blues (navy + sky blue), Paytm feel |
| Conversation agent | `claude-haiku-5-5` (env `MODEL_CONVERSE`) |
| Hunter agent | `claude-sonnet-5-5` (env `MODEL_HUNT`) |
| Notifier | `claude-haiku-5-5` (env `MODEL_NOTIFY`) |
| WhatsApp | ChakraHQ, pass-through webhook (Meta format), session message API for replies |
| Speech-to-text | Provider set by env `STT_PROVIDER` (Hindi + Hinglish + English) |
| Text-to-speech | Provider set by env `TTS_PROVIDER`; output must end as OGG/Opus for WhatsApp voice notes |
| Optional | n8n Postgres Trigger as an alternative watcher (section 6) |

Models are per role and swappable through env, so we can change them on the day without code changes.

---

## 3. Environment

```
DATABASE_URL=                 # Neon pooled
DATABASE_URL_UNPOOLED=        # Neon direct, for migrations and LISTEN
ANTHROPIC_API_KEY=
MODEL_CONVERSE=claude-haiku-5-5
MODEL_HUNT=claude-sonnet-5-5
MODEL_NOTIFY=claude-haiku-5-5

CHAKRA_API_KEY=
CHAKRA_PLUGIN_ID=
CHAKRA_PHONE_NUMBER_ID=       # Meta id of the agent number
CHAKRA_WEBHOOK_SECRET=        # set in Chakra: Admin > Team > Secrets
AGENT_WA_NUMBER=              # Hisaab's WhatsApp number (E.164)
DEMO_MERCHANT_PHONE=          # phone mapped to MID-0001 (E.164)
OPS_EMPLOYEE_PHONE=           # Paytm employee who approves on WhatsApp (E.164)

STT_PROVIDER=                 # sarvam | openai | elevenlabs
STT_API_KEY=
TTS_PROVIDER=
TTS_API_KEY=

INJECT_TOKEN=                 # shared secret for /inject and the CLI
WATCH_SECRET=                 # shared secret for /api/watch callers (n8n, cron)
APP_URL=
```

Check the ChakraHQ API docs (apidocs.chakrahq.com) for exact endpoints: "Send WhatsApp session message (pass-through)", "Upload Public Media", "Fetch Whatsapp Media API", "Inbound Events Webhook" (HMAC header `X-Chakra-Signature-256`). Do not guess endpoint paths: read the docs or ask.

---

## 4. Data model: 7 schemas

Six schemas mock Paytm's siloed systems. One is Hisaab's own memory. Every Paytm schema references `merchant_id` (the MID) only.

### merchants (Paytm merchant master, read only for Hisaab)
- `merchants`: `id` (MID, e.g. `MID-0001`), `business_name`, `owner_name`, `phone` (E.164), `city`, `language` (`hi` | `hinglish` | `en`), `segment`, `kyc_status`, `onboarded_at`, `is_demo`

### settlement
- `payments`: `id`, `merchant_id`, `txn_ref`, `amount`, `payer_vpa`, `order_ref` (nullable), `status` (`SUCCESS` | `PENDING` | `FAILED` | `REFUNDED`), `created_at`
- `settlements`: `id`, `merchant_id`, `date`, `gross`, `deductions_total`, `net`, `status`
- `deductions`: `id`, `settlement_id`, `merchant_id`, `type` (`RENT` | `LATE_FEE` | `DISPUTE` | `LOAN_EMI` | `FEE`), `amount`, `source_ref` (charge id / dispute id / loan id, nullable), `created_at`
- `credits`: `id`, `merchant_id`, `amount`, `reason`, `action_id`, `applied_settlement_id` (nullable), `created_at`

### billing
- `subscriptions`: `id`, `merchant_id`, `device_id`, `plan`, `monthly_rent`, `status` (`ACTIVE` | `CLOSED`), `started_at`, `closed_at`
- `charges`: `id`, `subscription_id`, `merchant_id`, `period` (`YYYY-MM`), `kind` (`RENT` | `LATE_FEE`), `amount`, `status` (`BILLED` | `DEDUCTED` | `REVERSED`), `deducted_in_settlement_id`, `notice_sent_at` (nullable)

### logistics
- `devices`: `id`, `serial`, `model` (`SOUNDBOX` | `EDC`), `merchant_id`, `last_seen_at` (heartbeat; offline if older than 30 min)
- `replacement_requests`: `id`, `device_id`, `merchant_id`, `reason`, `status` (`BOOKED` | `DISPATCHED` | `DONE`), `created_at`
- `device_events`: `id`, `device_id`, `type` (`DISPATCHED` | `DELIVERED` | `PICKUP_REQUESTED` | `PICKED_UP` | `RECEIVED_AT_WAREHOUSE` | `REPLACED`), `at`, `actor`

### disputes
- `disputes`: `id`, `merchant_id`, `payment_id`, `amount`, `reason`, `raised_by_vpa`, `status` (`OPEN` | `DEDUCTED` | `CONTESTED` | `WON` | `LOST`), `deducted_at`, `response_due_at`, `merchant_contested`, `response_text`, `evidence` (json)

### lending
- `loans`: `id`, `merchant_id`, `principal`, `outstanding`, `status` (`ACTIVE` | `SETTLED` | `CLOSED`), `settlement_offer_amount` (nullable)
- `loan_payments`: `id`, `loan_id`, `amount`, `kind` (`EMI` | `SETTLEMENT`), `at`

### hisaab (Hisaab's memory)
- `conversations`: `id`, `merchant_id`, `channel` (`WA` | `WEB`), `opened_at`, `last_inbound_at`
- `messages`: `id`, `conversation_id`, `direction` (`IN` | `OUT`), `audience` (`MERCHANT` | `OPS`), `type` (`TEXT` | `VOICE` | `IMAGE` | `DOCUMENT` | `BUTTONS`), `text`, `transcript`, `media_url`, `wamid`, `created_at`
- `cases`: `id`, `merchant_id`, `source` (`DETECTED` | `MERCHANT_ASKED`), `status` (`OPEN` | `AWAITING_MERCHANT` | `AWAITING_APPROVAL` | `RESOLVED` | `ESCALATED`), `summary`, `opened_at`, `resolved_at`, `detect_ms`
- `findings`: `id`, `case_id`, `origin` (`RULE` | `HUNTER`), `check` (verifier name), `title`, `amount`, `evidence_refs` (json), `evidence_source` (`LEDGER` | `MERCHANT_CLAIM`), `verified`, `verdict` (`WRONG` | `WARN` | `CONTESTABLE` | `MISMATCH` | `OK`)
- `actions`: `id`, `case_id`, `finding_id`, `type`, `amount`, `tier` (`AUTO` | `APPROVAL` | `ESCALATE`), `status` (`PROPOSED` | `EXECUTED` | `PENDING` | `APPROVED` | `REJECTED` | `UNDONE`), `reasoning`, `inverse` (json), `decided_by`, `decided_via` (`DASHBOARD` | `WHATSAPP`), `created_at`
- `trace_events`: `id`, `case_id`, `conversation_id`, `seq`, `kind` (`DETECT` | `THINK` | `TOOL_CALL` | `TOOL_RESULT` | `POLICY` | `ACTION` | `MESSAGE`), `name`, `payload` (json), `ms`, `created_at`
- `policy`: single row: `auto_limit` (1000), `approval_limit` (5000), `lending_always_escalate` (true)
- `wa_inbox`: `wamid` (unique), `raw` (json), `received_at`, `processed_at`
- `outbox_events`: `id`, `schema`, `table`, `row_id`, `op`, `merchant_id`, `created_at`, `processed_at`
- `injections` (scoreboard only, never visible to the agent): `id`, `type`, `merchant_id`, `is_decoy`, `params` (json), `created_at`, `detected_case_id`, `detected_at`

### Triggers
Add a Postgres trigger on every table in the six Paytm schemas that writes an `outbox_events` row and calls `pg_notify('ledger_change', merchant_id)` on insert or update.

---

## 5. Seed data

- **30 merchants** across Delhi, Noida, Gurugram, Ghaziabad and Faridabad. Segments: kirana, medical, sweets, mobile shop, restaurant, salon, stationery. Languages: about 50% Hinglish, 30% Hindi, 20% English.
- **MID-0001 is the demo merchant**: Ramesh Kirana Store, owner Ramesh Kumar, Noida, Hinglish, phone `DEMO_MERCHANT_PHONE`, `is_demo = true`.
- Every merchant has a Soundbox with `DISPATCHED` and `DELIVERED` events and an `ACTIVE` subscription at ₹135/month. 3 merchants also have an EDC.
- **6 months of history** (May to Oct 2026):
  - daily settlements for all 6 months
  - individual payments for the last 30 days (5 to 60 a day, ₹20 to ₹2,000, about 90% with an `order_ref`)
  - one rent charge per month, deducted from the first settlement of the month
- 6 merchants have loans with EMIs deducted from settlements. A handful have old, properly resolved disputes, so disputes aren't all suspicious.
- **Every merchant starts clean.** Every anomaly in the demo is injected live.
- Seed with batched `createMany`. `pnpm demo:reset` truncates everything and reseeds in a few seconds.

---

## 6. Detection pipeline

```
inject (CLI or panel)
  -> writes to Paytm schemas
  -> trigger writes outbox_events + pg_notify
  -> watcher calls POST /api/watch
  -> drain outbox, group by merchant, debounce 1.5 s
  -> for each changed merchant:
       rules engine (deterministic)  -> findings
       hunter (LLM)                  -> hypotheses -> verifiers -> findings
  -> open case, run policy, execute / request approval / escalate
  -> notifier messages merchant (and ops if needed) on WhatsApp
  -> trace_events stream to the dashboard
```

**Watchers.** Vercel functions can't hold a `LISTEN` connection, so build A first:
- **A. Dashboard heartbeat (build first).** While `/demo` or `/ops` is open, the page calls `/api/watch` every 1.5 s. The endpoint drains unprocessed `outbox_events` with `FOR UPDATE SKIP LOCKED`, so concurrent calls are safe.
- **B. n8n (optional).** An n8n Postgres Trigger node listens on `ledger_change` using `DATABASE_URL_UNPOOLED` and POSTs to `/api/watch` with `WATCH_SECRET`. This works with no browser open.

Record `detect_ms` on each case as the time from the outbox event to the case opening.

### The hunter (LLM hunts, engine verifies)
- **Input:** a compact JSON snapshot of the changed merchant for the last 90 days (subscriptions, charges, device events, settlements and deductions, disputes, loans), plus the outbox events that triggered the run.
- **Output (strict JSON):** a list of hypotheses `{ title, check, refs, why }`, where `check` must be one of the verifier names below.
- **Verification:** each hypothesis runs through its verifier in `src/engine/verifiers`. Only verified hypotheses become findings with an engine-computed amount.
- **Unverified but plausible hypotheses** become a finding with `verified = false`. They can never auto-execute and always route to approval.
- **Scope:** run the hunter only on merchants with new outbox events, never all 30.

### Verifiers (also used by the rules engine)

| Check | Logic | Verdict |
|---|---|---|
| `charge_after_return` | charge period starts after the device's `RECEIVED_AT_WAREHOUSE` (or `PICKED_UP`) date | WRONG |
| `charge_without_delivery` | charge on a device with no `DELIVERED` event | WRONG |
| `silent_deduction` | `BILLED` dues over ₹2,000 queued for the next settlement with `notice_sent_at` null | WARN |
| `orphan_dispute` | disputed payment has `order_ref` null and `merchant_contested` true | CONTESTABLE |
| `zombie_loan` | sum of `SETTLEMENT` payments ≥ `settlement_offer_amount` and status `ACTIVE` | MISMATCH |
| `duplicate_deduction` | same `source_ref` deducted in more than one settlement | WRONG |
| `deduction_without_source` | deduction of type `FEE` with null `source_ref` and no matching record | WRONG |
| `pickup_never_completed` | `PICKUP_REQUESTED` over 14 days ago, no `PICKED_UP`, rent still billing | needs merchant input |

The rules engine runs only the first five. `duplicate_deduction`, `deduction_without_source` and `pickup_never_completed` are reachable only through the hunter. That's deliberate: it proves the LLM finds things the rules don't.

---

## 7. Anomaly injector

Shared code lives in `src/inject/*`. It's used by the CLI (`pnpm inject ...`), the panel at `/inject?k=INJECT_TOKEN` (mobile friendly, judges can use it from a QR code) and `pnpm demo:script`. Every injection writes realistic multi-table data and a row in `hisaab.injections`.

Targets: `--demo` (MID-0001), `--merchant MID-xxxx` or `--random`.

| Type | What it writes | Expected outcome |
|---|---|---|
| `rent_after_return` | `PICKED_UP` + `RECEIVED_AT_WAREHOUSE` events about 4 months back. Subscription stays `ACTIVE`; 4 months of rent plus late fees after the return, deducted in the latest settlement. Demo amount ₹594. | auto reverse + close subscription |
| `ghost_device` | 2nd device with `DISPATCHED` only, 2nd subscription, 3 months of rent deducted (₹405) | auto reverse + close |
| `silent_deduction` | ₹2,800 of `BILLED` charges queued, no notice | warn merchant (auto, no money moves) |
| `orphan_dispute` | payment with no `order_ref` from an unknown VPA, dispute `DEDUCTED` ₹1,850, merchant contested | draft response, needs approval |
| `zombie_loan` | settlement payment equal to the offer amount, loan still `ACTIVE`, an EMI deducted after settlement | escalate (lending) |
| `duplicate_deduction` | the same rent charge deducted again in a later settlement (₹135) | hunter finds it, auto reverse |
| `deduction_without_source` | `FEE` deduction ₹299 with no source | hunter finds it, auto reverse |
| `device_offline` | sets the merchant's Soundbox `last_seen_at` to 3 hours ago | answers "Soundbox bol nahi raha" with real health data, books a replacement |
| `pending_payment` | adds a ₹500 payment in `PENDING` (or `FAILED` with `--failed`) from a customer VPA a few minutes ago | answers "customer ka paisa aaya kya?" with the real status |
| `pickup_never_completed` | `PICKUP_REQUESTED` 2 months ago, rent still billing (₹270) | agent asks merchant on WhatsApp first |

**Decoys** (`pnpm inject:decoy <type>`, `is_decoy = true`). The agent must not flag these:
- `legit_late_fee`: rent paid late, ₹54 late fee, device active and delivered
- `merchant_refund`: the merchant refunded a customer ₹500 themselves
- `slow_day`: a settlement 70% below average on a Sunday

**Scoreboard** (top of `/ops`): anomalies injected, anomalies caught, decoys correctly ignored, average detection time, money recovered.

**`pnpm demo:script`:** runs the scripted sequence in section 12 with pauses, printing each step in the terminal.

---

## 8. Agent design

### Roles
- **Concierge** (`MODEL_CONVERSE`): answers merchant messages on WhatsApp and web, at most 8 tool steps per turn.
- **Hunter** (`MODEL_HUNT`): runs in the background on changed merchants (section 6).
- **Notifier** (`MODEL_NOTIFY`): turns findings and actions into a short message in the merchant's language. Also writes approval requests for ops.

### Concierge tools
`lookup_merchant(phone)`, `get_statement(merchant_id, period)`, `get_ledger(system, merchant_id, filters)`, `reconcile(merchant_id)`, `verify(check, refs)`, `get_case(case_id)`, `propose_action(type, finding_id)`, `ask_merchant(case_id, question)`, `escalate(case_id, summary)`

Merchant-question tools (engine computes every number):
- `find_payment(merchant_id, amount?, from?, to?, payer_vpa?)`: matching payments with status and UPI reference
- `forecast_settlement(merchant_id, date)`: expected payout = successful payments not yet settled minus scheduled rent, EMIs and disputes, itemised
- `upcoming_deductions(merchant_id, until)`: what will be deducted, by type and date
- `compare_periods(merchant_id, a, b)`: payment count, payment total and deductions for two periods
- `get_device_health(merchant_id)`: each device with `last_seen_at`, online or offline, open replacement requests
- `book_replacement(device_id, reason)`: creates a replacement request (acts alone, no money moves)
- `request_pickup(device_id)`: schedules a return pickup and reports final dues
- `attach_evidence(dispute_id, media_id)`: reads a WhatsApp image (bill, delivery slip) with Claude vision, extracts amount and date, matches it to the disputed payment, stores it in `disputes.evidence`
- `send_statement_pdf(merchant_id, period)`: renders a monthly statement PDF and sends it as a WhatsApp document
- `handoff_to_human(summary)`: escalates with a summary so the merchant never repeats themselves

### System prompt essentials
- Reply in the merchant's language: Hindi, Hinglish or English. Mirror how they wrote.
- Never state a rupee amount that didn't come from a tool result. Never do arithmetic.
- Explain the split line by line, simply, like a helpful Paytm person. Keep voice replies to about 3 sentences.
- If evidence depends on the merchant's word, ask a yes/no question first.
- Never mention internal ids, rules or schemas to the merchant.
- Guardrail: never ask for, accept or repeat a UPI PIN, OTP, password or card number. If a merchant offers one, refuse, tell them Paytm never asks for it, and warn about the scam.
- Guardrail: if someone "sent extra money and wants it back", warn about the overpayment scam and advise refunds only through the app.
- Read-only questions never need policy: answer directly from tools.

### Policy engine (`src/engine/policy.ts`)
Apply these in order:
1. Kind `notify` → AUTO
2. Lending → ESCALATE
3. Finding unverified, or evidence source `MERCHANT_CLAIM` → at least APPROVAL
4. Amount ≤ `auto_limit` (₹1,000) → AUTO
5. Amount ≤ `approval_limit` (₹5,000) → APPROVAL
6. Otherwise → ESCALATE

### Executors (`src/engine/executors`, each returns its inverse)
- `reverse_charge`: charge status `REVERSED`, plus a `credits` row
- `reverse_deduction`: a `credits` row referencing the deduction
- `close_subscription`
- `schedule_pickup`: adds a `PICKUP_REQUESTED` event
- `contest_dispute`: writes `response_text` and `evidence`, status `CONTESTED`
- `send_warning`: sets `notice_sent_at`
- `book_replacement`: creates a `replacement_requests` row (inverse: cancel it)
- `request_pickup`: adds a `PICKUP_REQUESTED` event and stops future rent from that date

**Undo** runs the inverse, sets status `UNDONE` and messages the merchant.

### Approvals
- An APPROVAL action sets the case to `AWAITING_APPROVAL`.
- It appears in the `/ops` queue, and is sent to `OPS_EMPLOYEE_PHONE` as a WhatsApp interactive message with Approve and Reject buttons. The button payload is the action id.
- A button reply arriving at the webhook approves or rejects the action, then the merchant is messaged.
- If the ops 24-hour window is closed, use the `hisaab_approval` template.

---

## 9. WhatsApp and voice

- **`POST /api/whatsapp`:** verify `X-Chakra-Signature-256` (HMAC SHA-256 of the raw body with `CHAKRA_WEBHOOK_SECRET`), insert into `wa_inbox` (ignore a duplicate `wamid`), return 200, then process in `after()`.
- **Route by sender:**
  - `OPS_EMPLOYEE_PHONE` → button replies and approvals
  - a known merchant phone → the concierge
  - anything else → a polite "not registered" reply
  - status events → ignore, apart from logging
- **Voice in:** fetch the media through Chakra's media API, then STT. Store both the transcript and the audio.
- **Voice out:** for voice inbound, reply with a voice note and the same text as a second message. The TTS output must be OGG/Opus to show as a voice note: prefer a provider that returns Opus directly. Upload through Chakra's upload media API, then send an audio message.
- **Images in:** when a merchant sends a photo, fetch it through Chakra's media API and pass it to Claude as an image. If a dispute is open, the agent calls `attach_evidence`.
- **Documents out:** statement PDFs are uploaded through Chakra and sent as document messages with a short caption.
- **24-hour window:** the demo merchant and the ops phone both message the agent number at the start of the day. Proactive messages outside the window use templates.
- **Templates** (submit tonight):
  - `hisaab_alert` (utility): "Namaste {{1}}, aapke Paytm Business account mein {{2}} ka ek update hai: {{3}}. Poori jaankari ke liye is message ka jawab dein."
  - `hisaab_approval` (utility, quick-reply buttons Approve and Reject): "Approval needed for {{1}} ({{2}}): {{3}}, amount {{4}}. Case {{5}}."

---

## 9b. Merchant questions to support

Build these five first. The rest mostly work for free once the tools exist.

| Priority | Merchant asks | Tools |
|---|---|---|
| 1 | "Customer bol raha ₹500 kat gaya, mere paas aaya kya?" | `find_payment` |
| 2 | "Kal ka settlement kitna aayega?" / "Is mahine kitna katne wala hai?" | `forecast_settlement`, `upcoming_deductions` |
| 3 | Photo of a bill for a disputed payment | `attach_evidence`, then `propose_action(contest_dispute)` |
| 4 | "Soundbox bol nahi raha" / "Soundbox wapas karna hai" | `get_device_health`, `book_replacement`, `request_pickup` |
| 5 | "OTP aaya hai, bata doon?" | guardrail in the system prompt, no tool |

Also supported: "Ye ₹135 kis cheez ka kata?" (`get_statement`), "Is hafte kam paise kyun aaye?" (`compare_periods`), "Loan kitna baaki hai?" (`get_ledger(lending)`), "Loan band karna hai" (`handoff_to_human`), "Pichle mahine ka hisaab PDF mein bhejo" (`send_statement_pdf`), "Kisi insaan se baat karni hai" (`handoff_to_human`).

---

## 10. Screens

Paytm visual feel: navy and sky blue, white cards, Paytm-like type. Toasts on detection. Sounds: a chime on every new detection in ops. On the merchant page, when a credit lands, play a Soundbox-style Hindi announcement generated with TTS ("Paytm par ₹594 refund prapt hue"). Don't use Paytm's actual audio files.

| Route | Who | What |
|---|---|---|
| `/demo` | judges | Split screen: merchant page on the left, ops overview on the right, scoreboard on top |
| `/ops` | Paytm employee | Scoreboard, live "watching ledgers" pulse, case queue (pending approval, escalated, recent auto), live trace of the active case |
| `/ops/merchants` | Paytm employee | All 30 merchants, health badge (clean / issue / fixed), filters |
| `/ops/merchants/[mid]` | Paytm employee | Merchant profile, ledgers across all six systems, cases |
| `/ops/cases/[id]` | Paytm employee | Findings with evidence, reconciliation table, trace timeline, actions with Approve / Reject / Undo |
| `/ops/policy` | Paytm employee | The autonomy dial: auto limit and approval limit sliders, live |
| `/ops/audit` | Paytm employee | Every action, who decided it, via which channel |
| `/m/[mid]` | Merchant | Full page: "Mera Hisaab" statement (each settlement with every deduction explained, credits, upcoming warnings), WhatsApp conversation mirror, web voice/text input as fallback |
| `/inject` | Presenter, judges | Chaos panel: anomaly buttons, decoy buttons, target picker, reset. Mobile friendly. |

Realtime: poll every 1.5 s. No websockets.

---

## 11. Repo layout

```
hisaab/
  CLAUDE.md
  prisma/schema.prisma          # 7 schemas
  prisma/sql/triggers.sql       # outbox triggers
  prisma/seed.ts
  scripts/inject.ts  scripts/reset.ts  scripts/demo-script.ts
  src/systems/                  # merchants, settlement, billing, logistics, disputes, lending
  src/engine/verifiers/         # one file per check
  src/engine/reconcile.ts       # runs rules
  src/engine/policy.ts
  src/engine/executors/
  src/agent/concierge.ts  hunter.ts  notifier.ts  tools.ts  prompts.ts  trace.ts
  src/channels/whatsapp.ts      # Chakra send, media, HMAC
  src/channels/voice.ts         # STT, TTS, Opus
  src/inject/                   # shared by CLI, panel, demo script
  src/app/api/whatsapp/route.ts
  src/app/api/watch/route.ts
  src/app/api/chat/route.ts     # web channel, same concierge
  src/app/api/inject/route.ts
  src/app/api/actions/[id]/(approve|reject|undo)/route.ts
  src/app/(ops)/...  src/app/m/[mid]/...  src/app/demo/...  src/app/inject/...
  video/                        # Remotion
```

---

## 12. Demo script (`pnpm demo:script`)

1. Reset. Show 30 clean merchants in `/ops/merchants`.
2. Inject `rent_after_return --demo`. Ops detects it in about a second; ₹594 is auto-reversed. Ramesh's phone receives a Hinglish voice note. The merchant page plays the credit announcement.
3. Ramesh replies by voice: "Mera ₹1,134 kahan gaya?" The concierge explains the split from the ledger.
4. Drag the auto limit to ₹500 on `/ops/policy`. Inject `ghost_device --demo`: ₹405 still auto. Then inject `rent_after_return --random`: it now waits for approval. Approve from the ops phone on WhatsApp.
5. Inject `orphan_dispute`: the evidence pack is drafted, approved in the dashboard.
6. Inject `zombie_loan`: escalated with the full case file.
7. Inject `duplicate_deduction` and `deduction_without_source`: caught by the hunter (show origin `HUNTER` in the trace).
8. Inject 3 decoys: nothing flagged. The scoreboard shows them ignored.
9. Inject `pickup_never_completed --demo`: the agent asks Ramesh on WhatsApp, he says "haan, le gaye the", and it goes to approval because the evidence is the merchant's word.
10. Inject `pending_payment --demo`. Ramesh asks by voice "Customer bol raha ₹500 kat gaya, mere paas aaya kya?" and gets the real status with the UPI reference.
11. Inject `device_offline --demo`. Ramesh says "Soundbox bol nahi raha": the agent reports when it went offline, gives two quick checks, then books a replacement.
12. For Ali's dispute, send a photo of a handwritten bill. The agent reads it, matches the amount and attaches it as evidence.
13. Ask "Kal kitna aayega?" and "Pichle mahine ka hisaab PDF mein bhejo".
14. Try the guardrail: "OTP aaya hai, bata doon?"
15. Hand judges the QR for `/inject` and let them break things.

---

## 13. Build order (31 Oct)

| Time | Work |
|---|---|
| 9:30 | Scaffold, deploy, Chakra webhook receiving, echo reply working |
| 10:15 | Schemas, triggers, seed, reset |
| 11:00 | Injector (CLI + panel), watcher, outbox drain |
| 11:45 | Verifiers, rules, policy, executors with undo |
| 12:30 | Lunch |
| 1:00 | Concierge + hunter + notifier, trace events |
| 2:00 | WhatsApp text in/out, then voice in/out |
| 3:00 | Ops dashboard, approvals (dashboard, then WhatsApp buttons) |
| 4:00 | Merchant page, `/demo` split, sounds, scoreboard |
| 4:45 | Freeze. Record the screen, rehearse `demo:script` twice |

**Cut order if behind:**
0. `send_statement_pdf`, then `compare_periods`
1. WhatsApp approval buttons (keep dashboard approval)
2. n8n watcher
3. Voice replies (keep voice in, reply as text)
4. `/ops/audit`
5. `/ops/merchants/[mid]`

**Never cut:** injector, live detection, hunter, policy dial, Undo, WhatsApp voice in.

---

## 14. Audience pays the merchant (live demo feature)


1. Pay page: /pay/[mid]?k=PAY_TOKEN (add PAY_TOKEN to env)
   - Mobile-first, Paytm-style look (navy and sky blue, white cards).
   - Header: merchant business name and city from merchants.merchants (read-only, not editable).
   - Payer name: text input (1 to 30 chars) plus quick-pick chips: "Judge", "Mentor", "Guest".
   - Amount: large keypad, whole rupees, ₹1 to ₹5,000.
   - Pay button opens a 4-digit PIN pad with "Demo PIN: 1111" printed above it.
   - Permanent banner on every screen: "Demo only. No real money. Never enter your real UPI PIN."
   - Wrong PIN: shake animation and an inline error, no request sent twice.
   - Success screen: green tick, amount, "Paid to <business name>", txn ref, time.

2. POST /api/pay
   - Validate the token, that the MID exists, amount 1 to 5000, and payer name; check pin === "1111" on the server.
   - Rate limit: one payment per IP every 5 seconds.
   - Insert into settlement.payments with status SUCCESS, a generated txn_ref, payer_vpa as <slugified-name>@demo,
     order_ref "DEMO-<short id>", and a new nullable column payer_name (add a migration).
   - Let the normal outbox trigger fire.

3. Watcher: for outbox events that are only new SUCCESS payments with an order_ref, mark them processed and
   skip the rules engine and the hunter. No case, no LLM call.

4. Live payments on screen
   - On /m/[mid] and /demo: a live payments feed (poll every 1.5 s) with payer name, amount and time.
   - On each new payment: a toast ("Judge paid ₹100") and a Soundbox-style announcement played with Sarvam TTS in Hindi:
     "Paytm par ₹<amount> prapt hue". Cache the audio per amount. Fall back to a short chime if TTS fails.
   - Browsers block autoplay: add a one-time "Enable sound" button on /demo and /m/[mid].

5. QR on the dashboard
   - On /demo and /ops/merchants/[mid]: a large QR code for APP_URL/pay/<mid>?k=PAY_TOKEN, labelled
     "Scan to pay <business name>". Use the qrcode npm package.

6. New concierge tool: daily_summary(merchant_id, date)
   - The engine computes: successful payment count and total today, pending and failed counts, biggest payment and payer
     name, first and last payment time, today's scheduled deductions, expected next settlement (reuse forecast_settlement),
     and the change versus yesterday at the same time.
   - The concierge uses it for "Aaj ka hisaab batao", "daily summary", "aaj kitna aaya". Voice reply about 3 sentences,
     full breakdown in the text message.

**Acceptance test (end to end):**
- Ask on WhatsApp "Aaj ka hisaab batao" and note the total.
- Open the pay page on a phone, pay ₹100 as "Judge" with PIN 1111.
- Row appears in settlement.payments, /m/MID-0001 announces it within 2 seconds.
- Ask "Aaj ka hisaab batao" again on WhatsApp: the total now includes the ₹100.
