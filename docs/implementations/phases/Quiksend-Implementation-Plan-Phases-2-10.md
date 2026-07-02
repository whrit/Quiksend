# Quiksend — Implementation Plan, Phases 2–10

Companion to `design_implementation_v1.md`. That document set the architecture and
the ticket outline; this one expands Phases 2–10 into buildable detail: data model,
server surface, UI, the hard mechanics, a sub-task breakdown per ticket, testing, and
concrete exit criteria.

**Status of the codebase this builds on:** Phases 0–1 are built and verified — the
monorepo (pnpm + Turborepo), `packages/config` (env + logger), `packages/db` (Drizzle +
Postgres + migrations), `packages/auth` (Better Auth: email/password + Google/Microsoft,
`organization` = workspace, `apiKey`), and `apps/web` (TanStack Start shell: login,
protected layout, workspace switcher). CI + the release/versioning pipeline (Release
Please → GHCR images) are in place.

**How to read this.** Each phase has the same shape: Goal → Builds on → Data model →
Server surface → UI → Mechanics → Tickets → Testing → Risks → Exit. The Mechanics
section is where the genuinely hard parts live; skim the rest, read those. Interfaces
we own (server fns, adapters, the state machine) are specified concretely. External
library calls (Nango, pg-boss, Gmail/Graph, AI SDK) are described at the design level —
pin exact versions and confirm current signatures at implementation time, the same way
Phase 1's deps were verified.

---

## Cross-cutting conventions

These hold for every phase; individual phases assume them rather than repeating them.

### Identity, tenancy, and timestamps

- **App-owned tables** use a `uuid` primary key (`gen_random_uuid()`), matching the
  existing `app_meta` table. Foreign keys to Better Auth entities (`user`,
  `organization`) are `text`, referencing their `id` (Better Auth uses text ids — see
  the generated `auth.ts`).
- **Every app table is org-scoped:** `organization_id text not null references
organization(id) on delete cascade`, and that column is indexed (most tables also want
  a composite index leading with `organization_id`). "Org" and "workspace" are the same
  thing (the Better Auth `organization` plugin).
- Timestamps are `timestamptz`: `created_at` (`defaultNow()`) and `updated_at`
  (`defaultNow()` + `$onUpdate`). Soft-delete via `deleted_at timestamptz` only where a
  table needs it (prospects, sequences); everything else hard-deletes with cascade.

### Server functions and authorization

- All data access goes through **TanStack Start server functions** (`createServerFn`),
  never client-side DB calls. Build one wrapper — `orgFn` — layered on Phase 1's
  `ensureSession`: it resolves `session.activeOrganizationId`, throws `redirect`/403 if
  absent, and injects `{ userId, organizationId, role }` into the handler. Every
  org-scoped query then filters by that `organizationId`. This is the single tenancy
  chokepoint.
- Mutations validate input with **Zod** via `.inputValidator(...)`. Reject unknown
  fields; coerce/normalize (emails lowercased, domains punycoded) at this boundary.
- **Role gates** use the `member.role` from the organization plugin (owner/admin/member):
  connecting CRMs/mailboxes, managing billing, and deleting workspaces are admin-only;
  day-to-day prospect/sequence work is any member.

### Migrations

Schema lives in `packages/db/src/schema/*.ts`, re-exported from the barrel. Per phase:
add schema files → `pnpm db:generate` → **review the generated SQL** (especially
indexes, FKs, `on delete`) → `pnpm db:migrate`. Never hand-edit applied migrations;
add a new one. Keep each migration reviewable (one phase's tables per migration is fine).

### Background work (pg-boss)

Long-running and deferred work runs in `apps/worker` on **pg-boss** (a Postgres-backed
queue — no extra infra, and it coexists with the app schema). Producers are server fns
(`boss.send('job.name', payload)`); consumers are handlers registered in the worker.
Job names are namespaced: `sequence.tick`, `sequence.step`, `mailbox.poll`,
`crm.sync`, `crm.writeback`, `webhook.deliver`, `ai.research`.

> **Sequencing note (important):** the ticket outline introduces pg-boss in Phase 6, but
> Phase 3 (CRM webhooks/sync) and Phase 4 (send) both benefit from async processing.
> **Recommended adjustment:** stand up the pg-boss bootstrap (a slim version of R-061 —
> connection, schema install, a `worker` process that registers handlers) in **Phase 3**,
> and keep only the _scheduler tick_ and _step executor_ in Phase 6. Phases below are
> written assuming this: if you'd rather hold pg-boss to Phase 6, Phase 3's webhook
> handler and Phase 4's send can run inline (synchronously in the server fn) as an
> interim, with a note to move them onto the queue when it lands.

### Testing & Definition of Done

- **Pure logic** (the state machine, MIME builder, CSV dedupe, field mapping, schedule
  math, bounce parsing) → vitest unit tests co-located in the package. These are the
  highest-value tests; aim for exhaustive transition coverage on the engine.
- **Integration** → tests against the CI Postgres service (already in `ci.yml`), each
  test isolated by truncation or a fresh schema. Cover tenancy (a query from org A must
  never see org B's rows), migrations apply cleanly, and server-fn happy/again paths.
- **Provider adapters** (Gmail/Graph/SMTP, Nango, AI providers) sit behind interfaces
  with in-memory fakes for unit tests, plus a small, env-gated set of live "smoke" tests
  run manually/nightly, never in the PR gate.
- **DoD per ticket:** `pnpm check` green; migration reviewed; org-scoping enforced _and_
  covered by a tenancy test; Sentry instrumentation on new server fns/jobs; structured
  pino logs carry `organizationId` + the relevant entity id; user-facing changes noted
  in README/RELEASING if operationally relevant. Conventional-commit PR title (the
  `lint-pr` gate) so Release Please versions it correctly.

### New packages introduced later

- `packages/integrations` (Phase 3) — Nango client wrapper, CRM provider config, sync +
  webhook plumbing.
- `packages/mail` (Phase 4) — `MailboxAdapter` interface + Gmail/Graph/SMTP
  implementations, react-email rendering, MIME + threading/compliance headers.
- `packages/core` (Phase 6) — the enrollment state machine and pure transition/schedule
  functions (no I/O; the most heavily unit-tested package).
- `packages/ai` (Phase 8) — provider-agnostic model + search interfaces, research and
  generation pipelines.

### Consolidated entity map (built up across the phases)

| Phase | New tables (org-scoped unless noted)                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| 2     | `company`, `prospect`, `list`, `list_member`, `import_batch`, `import_error`                                        |
| 3     | `crm_connection`, `sync_state`; adds `crm_provider`/`crm_external_id`/`crm_connection_id` to `prospect` + `company` |
| 4     | `mailbox`, `message` (the outbound/anchor store; inbound added in P7)                                               |
| 5     | `sequence`, `sequence_step`, `enrollment`                                                                           |
| 6     | `task`, `send_reservation` (or a counter), `job_log`; extends `enrollment` (anchor, attempt, error)                 |
| 7     | `suppression`; extends `message` (inbound direction, bounce metadata), thread linkage                               |
| 8     | `research_profile` (+ pgvector embedding), `value_prop`, `generation`                                               |
| 9     | `crm_writeback_log`; analytics rollup views/tables                                                                  |
| 10    | `api_usage`, `webhook_endpoint`, `webhook_delivery`, `unsubscribe_token`                                            |

---

## Phase 2 — Prospects & Companies

**Goal.** The system of record for who you're reaching out to: org-scoped `company` and
`prospect` entities, CSV import with column mapping + dedupe, and a prospect detail view
with a timeline that later phases fill in.

**Builds on.** Phase 1 (org scoping, `orgFn`, TanStack Table + shadcn in `apps/web`).

### Data model

- **`company`** — `id`, `organization_id`, `name`, `domain` (normalized, lowercased),
  `industry`, `size`, `website`, `linkedin_url`, `custom jsonb` (typed-loose extra
  fields), timestamps. Unique: `(organization_id, domain)` where domain not null.
- **`prospect`** — `id`, `organization_id`, `company_id` (nullable FK), `first_name`,
  `last_name`, `email` (stored lowercased), `title`, `linkedin_url`, `phone`,
  `timezone`, `status` (enum: `new`/`active`/`replied`/`bounced`/`unsubscribed`/
  `do_not_contact`), `source` (enum: `manual`/`csv`/`crm`/`api`), `custom jsonb`,
  `deleted_at`, timestamps. Unique: `(organization_id, email)`. Index `(organization_id,
status)` and `(organization_id, company_id)`.
- **`list`** + **`list_member`** — lightweight segments (`list`: id, org, name; join:
  list_id + prospect_id). Cheap now, needed by Phase 3 ("pull contacts into a list") and
  Phase 5 (bulk enroll a list).
- **`import_batch`** — `id`, `organization_id`, `filename`, `mapping jsonb`, counts
  (`created`/`updated`/`skipped`/`errored`), `status`, `created_by`, timestamps.
  **`import_error`** — per-row failures (`batch_id`, `row_number`, `raw jsonb`,
  `reason`) for a downloadable error report.

`email` as the natural dedupe key: store lowercased; treat `(org, email)` as the upsert
target. Company dedupe is by normalized `domain`.

### Server surface (`orgFn`)

`listProspects` (filter by status/list/company/search, sort, keyset-paginate),
`getProspect`, `createProspect`, `updateProspect`, `deleteProspect` (soft),
`bulkDeleteProspects`; `listCompanies`, `upsertCompany`; `createList`, `addToList`,
`removeFromList`; `startImport` (accepts parsed rows + mapping, returns a batch summary).

### UI

- Prospects table (TanStack Table): columns, filters, saved-view-ish query params,
  row-select for bulk actions, pagination.
- Prospect detail: fields (inline edit), company panel, and a **timeline** — for now it
  renders create/import/field-change events and shows empty "sequence history / messages"
  sections that Phases 5–7 populate.
- CSV import wizard: upload → parse headers → **column-mapping step** (map each CSV
  column to a prospect/company field or "ignore", remember mappings per org) → preview +
  validation report → confirm → batch summary with a downloadable error CSV.

### Mechanics

- **CSV parsing:** papaparse streaming so large files don't blow memory. Validate per
  row (email format, required fields), normalize (trim, lowercase email, derive/attach
  company by domain). Dedupe within the file _and_ against existing rows.
- **Dedupe/upsert:** `insert ... on conflict (organization_id, email) do update` with a
  policy toggle (skip vs. update existing). Attach/create company by domain in the same
  pass. Accumulate counts + error rows.
- **Small vs. large imports:** ≤ a few thousand rows can run synchronously in the server
  fn. For larger files, enqueue `crm.import`-style processing on pg-boss (available from
  Phase 3 per the sequencing note) and stream progress into `import_batch`.

### Tickets

- **R-020** — `company`/`prospect`/`list` schema + migration; `orgFn` CRUD; tenancy tests.
- **R-021** — CSV import: parser, mapping UI, validation, dedupe/upsert, `import_batch`/
  `import_error`, error-report download.
- **R-022** — prospect detail view: fields + inline edit, company panel, timeline shell
  with placeholders for later phases.

### Testing

Unit: email/domain normalization, dedupe policy, mapping application, row validation.
Integration: import a fixture CSV → correct create/update/skip counts + error rows;
tenancy (org A can't read/update org B's prospects); keyset pagination stability.

### Risks & decisions

Dedupe key choice (email; case-insensitive) — document it; custom fields as `jsonb`
now, promote hot ones to columns later; large-file memory (stream, don't buffer);
company auto-linking heuristics (domain match) can mis-group free-mail addresses —
only auto-link on corporate domains.

### Exit (AC C1, C3)

Import a CSV with a custom column mapping, land deduped prospects/companies, and view a
prospect with its (currently sparse) timeline.

---

## Phase 3 — Nango wiring + inbound CRM sync

**Goal.** Connect Salesforce/HubSpot via Nango, pull contacts/accounts into
prospects/companies on an incremental, checkpointed basis, and stay fresh via webhooks.
Also: stand up the pg-boss worker (per the sequencing note).

**Builds on.** Phase 2 (prospect/company + `list`), Phase 1 (admin role gate, `orgFn`).

### New package: `packages/integrations`

Wraps the **Nango node SDK** (server) and centralizes provider config
(`salesforce`, `hubspot`): integration ids, scopes, sync/model names, and the mapping
from provider records → Quiksend fields. Exposes typed helpers the app calls
(`createConnectSession`, `listConnections`, `fetchChangedRecords`, `verifyWebhook`) so
Nango specifics stay in one place.

### Data model

- **`crm_connection`** — `id`, `organization_id`, `provider` (`salesforce`/`hubspot`),
  `nango_connection_id`, `status`, `field_mapping jsonb`, `last_sync_at`, timestamps.
  Admin-created.
- **`sync_state`** — per (connection, model) cursor/checkpoint + last run info, so syncs
  are incremental and resumable.
- **Extend `prospect` + `company`** with `crm_provider`, `crm_external_id`,
  `crm_connection_id`, `last_crm_sync_at`. Add unique `(organization_id, crm_provider,
crm_external_id)` to dedupe CRM records; reconcile with the email/domain keys from
  Phase 2 (same person from CSV + CRM must merge, not duplicate).

### Connect flow

- Server fn `createCrmConnectSession(provider)` (admin) → a Nango **connect session
  token** scoped to this org's connection id.
- UI uses the **Nango frontend SDK** (`@nangohq/frontend`) to open the hosted connect UI
  with that token; on success, persist the `nango_connection_id` + set status.

### Inbound sync

- Use **Nango syncs** (managed/scripted, checkpointed) for contacts + accounts. Nango
  notifies via webhook when new records are available; the handler fetches changed
  records (records API, by cursor from `sync_state`) and **upserts** into
  prospect/company through the Phase-2 dedupe/upsert path, applying `field_mapping`.
- **Webhook route** `/api/nango/webhook` (TanStack server route): verify Nango's
  signature, then enqueue `crm.sync` on pg-boss; the worker does the fetch + upsert so
  the webhook returns fast. (Interim inline processing if pg-boss isn't up yet.)
- Field-mapping settings UI: map CRM fields → Quiksend fields per connection; sane
  defaults per provider.

### Mechanics & gotchas

- **Dedupe across sources:** an incoming CRM contact may match an existing prospect by
  email (from CSV) — merge onto the same row, attach `crm_external_id`, don't create a
  duplicate. Define precedence (CRM vs. manual edits) explicitly.
- **Incremental cursors** live in `sync_state`; make the fetch idempotent (re-processing
  a webhook must not double-apply).
- **Signature verification** on the webhook is mandatory (it's public); reject
  unverified. Rate-limit and dedupe webhook deliveries.
- **Verify current Nango API** at build time — the sync/records/webhook surface and the
  connect-session flow are the load-bearing external contract here.

### Tickets

- **R-030** — `packages/integrations` Nango wrapper + `crm_connection`/`sync_state`
  models; **pg-boss bootstrap** (connection, schema install, worker process + handler
  registry) per the sequencing note.
- **R-031** — connect flow: `createCrmConnectSession` + frontend connect UI (SF + HS),
  connection status UI.
- **R-032** — checkpointed contact/account syncs → mapped upsert into prospect/company;
  `crm.sync` job; cursor management.
- **R-033** — field-mapping settings UI; `/api/nango/webhook` route (verify + enqueue).

### Testing

Unit: field-mapping application, dedupe/merge precedence, webhook signature verify,
cursor advance idempotency. Integration: simulated webhook → job → upsert produces the
right merged rows; replay a delivery → no duplicates. Live smoke (env-gated): connect a
real SF/HS sandbox, pull a handful of contacts.

### Risks & decisions

Nango sync model specifics (managed vs. custom sync scripts) — decide early; webhook
replay/idempotency; merge precedence between CRM and manual/CSV data; CRM rate limits
(Nango proxy handles some); partial-failure handling mid-sync (checkpoint before ack).

### Exit (AC C2)

Connect Salesforce or HubSpot, pull contacts into a list, and see a subsequent CRM
update arrive via webhook and update the prospect.

---

## Phase 4 — Mailboxes & single send

**Goal.** Connect sending identities (Gmail, Microsoft, SMTP), send a real one-off email
through them, and record it — capturing the threading anchor and writing the `message`
row that the engine (Phase 6) and inbox (Phase 7) build on. Plus deliverability health
(SPF/DKIM/DMARC).

**Builds on.** Phase 3 (Nango for Gmail/Microsoft OAuth), Phase 2 (send to a prospect).

### New package: `packages/mail`

Defines the **`MailboxAdapter`** interface and its three implementations, plus
react-email rendering and the MIME/headers builder. The interface (ours to define):

```
interface MailboxAdapter {
  send(input: OutboundEmail): Promise<SendResult>;   // returns providerMessageId + threadId + RFC Message-ID
  // OutboundEmail carries: from, to, subject, html/text, inReplyTo?, references?, headers (List-Unsubscribe, etc.)
  verifyIdentity(): Promise<IdentityHealth>;         // domain auth / send-as checks
}
```

- **Gmail** — via Nango-managed OAuth; send with the Gmail API (raw RFC822 MIME +
  `threadId` for replies). Capture the returned message/thread ids and the RFC
  `Message-ID`.
- **Microsoft** — via Nango-managed OAuth; send via Microsoft Graph. Capture
  Graph/internet message ids for threading.
- **SMTP** — nodemailer; store SMTP creds encrypted at rest. Threading via
  `In-Reply-To`/`References` headers you set yourself.

### Data model

- **`mailbox`** — `id`, `organization_id`, `owner_user_id`, `provider`
  (`gmail`/`microsoft`/`smtp`), `address`, `display_name`/`from_name`,
  `nango_connection_id` (nullable), `smtp_config jsonb` (nullable, encrypted),
  `daily_cap`, `send_window` (start/end + `tz`), `throttle_seconds`, `signature_html`,
  health flags (`spf_ok`/`dkim_ok`/`dmarc_ok`, `status`), timestamps.
- **`message`** — the anchor + audit store. `id`, `organization_id`, `mailbox_id`,
  `prospect_id`, `enrollment_id` (nullable, set by the engine), `direction`
  (`outbound` now; `inbound` in P7), `subject`, `body_html`/`body_text`,
  `message_id_header` (RFC Message-ID — the **anchor**), `provider_message_id`,
  `provider_thread_id`, `in_reply_to`, `references`, `status`
  (`sent`/`failed`/`bounced`/`received`), `sent_at`, timestamps. Index the header ids for
  thread matching in P7.

### Mechanics

- **Email building:** react-email components render to HTML; a MIME builder assembles
  multipart/alternative with correct threading headers, a `List-Unsubscribe`
  (+ one-click `List-Unsubscribe-Post`) header, and a compliant footer (physical
  address + unsubscribe link — the actual suppression wiring lands in P10, but the
  footer/headers start here).
- **Single send:** compose UI → adapter `send()` → on success **capture the anchor**
  (RFC `Message-ID` + provider `threadId`) → write the outbound `message`. This anchor
  is exactly what the manual-first engine threads follow-ups under.
- **Health:** SPF/DKIM/DMARC checked via DNS lookups for the sending domain; surface
  flags on the mailbox and warn on send from an unauthenticated domain.
- **Caps/window/throttle** are _defined_ here (mailbox fields) and _enforced_ by
  `reserveSendSlot` in Phase 6; a single manual send should still respect a basic guard.

### Tickets

- **R-040** — `MailboxAdapter` interface + Gmail/Microsoft (Nango) + SMTP (nodemailer).
- **R-041** — mailbox connect UI + settings (cap/window/throttle/signature/from-name).
- **R-042** — react-email + MIME builder + threading headers + unsubscribe/address footer.
- **R-043** — compose & send one-off; capture anchor; write outbound `message`.
- **R-044** — SPF/DKIM/DMARC checker + health flags.

### Testing

Unit: MIME assembly (headers, multipart, threading fields), footer/unsubscribe injection,
adapter behavior against in-memory fakes, DNS-record parsing for auth checks. Live
smoke (env-gated): send a real email through each provider to a test inbox; confirm it
threads and the anchor is captured.

### Risks & decisions

Gmail/Graph send + threading specifics (verify current APIs — threadId vs. References
semantics differ); MIME correctness is fiddly (test hard); SMTP credential encryption
(use a KMS/DB-side crypto, never plaintext); OAuth scopes via Nango; per-provider
"send-as"/identity constraints; bounce handling deferred to P7 but design `message`
to record it.

### Exit (AC B1–B3, E1)

Connect a mailbox, send a manual email, and see it correctly threaded at the provider and
recorded as a `message` with its anchor.

---

## Phase 5 — Sequence model & builder

**Goal.** Model multi-step sequences and give users a builder to author them, then enroll
prospects (single + bulk) with mailbox round-robin and an accurate schedule preview.

**Builds on.** Phase 2 (prospects/lists), Phase 4 (mailboxes; templates that will send).

### Data model

- **`sequence`** — `id`, `organization_id`, `name`, `status`
  (`draft`/`active`/`archived`), `settings jsonb` (send window + `tz`, throttle,
  `mailbox_ids[]`, `stop_on_reply`), `deleted_at`, timestamps.
- **`sequence_step`** — `id`, `organization_id`, `sequence_id`, `index` (order),
  `type` (`manual_email`/`auto_email`/`wait`/`task`), `delay` (interval — time after the
  previous step), `config jsonb` (subject/body template, task instructions, wait
  duration, entry conditions), `ab_variant jsonb` (nullable — variant B), `ai_generate`
  (bool). Unique `(sequence_id, index)`.
- **`enrollment`** — created here, driven in Phase 6. `id`, `organization_id`,
  `sequence_id`, `prospect_id`, `mailbox_id` (round-robin assigned), `state` (the P6 state
  machine), `current_step_index`, `next_run_at`, `anchor_message_id` (nullable),
  `ab_bucket`, timestamps. Unique `(organization_id, sequence_id, prospect_id)` — prevent
  double-enrollment.

### UI

Builder: ordered step list with **dnd-kit** reorder, per-type step editors (email
template with variables, wait duration, task instructions, conditions), A/B variant-B
editor, and an AI-generate toggle per email step. Sequence settings panel (window/tz/
throttle/mailboxes/stop-on-reply). Enroll dialog: pick prospects or a list → preview the
computed schedule → confirm.

### Mechanics

- **Templates & variables:** steps store templates with `{{first_name}}`-style tokens.
  Rendering happens at _send_ time (Phase 6) so values are current; the builder validates
  tokens against known fields and shows a preview with sample data.
- **Enrollment + round-robin:** bulk enroll assigns mailboxes round-robin across the
  sequence's `mailbox_ids` to spread volume. Enforce the unique constraint to make
  re-enrolling a no-op (or an explicit "re-enroll" action).
- **Schedule preview** computes per-step times from `delay` + send window + throttle —
  and **must use the same function the engine uses** (extract it into `packages/core` in
  Phase 6 and import it here) so preview matches reality. Until then, a clearly-labeled
  estimate.

### Tickets

- **R-050** — `sequence`/`sequence_step`/`enrollment` schema + CRUD server fns.
- **R-051** — builder UI (ordered steps, delays, conditions, A/B variant B, AI-generate
  flag).
- **R-052** — sequence settings (window/tz/throttle/mailboxes/stop-on-reply).
- **R-053** — enrollment creation (single + bulk) with mailbox round-robin + schedule
  preview.

### Testing

Unit: template token validation, round-robin distribution, schedule-preview math (shared
fn), step-ordering integrity. Integration: bulk enroll a list → correct enrollments,
mailbox spread, no duplicates; draft→active transitions.

### Risks & decisions

Keep the schedule-preview math and the engine's scheduler as _one_ function to avoid
drift; A/B assignment strategy (deterministic bucket on enrollment); condition model
scope (start simple: has-replied/has-opened later); template variable safety (escape
HTML, handle missing values).

### Exit (AC D1–D5)

Build a multi-step sequence with a manual first step and automated follow-ups, enroll
prospects, and see a computed schedule.

---

## Phase 6 — Scheduler & engine (the core)

**Goal.** Turn enrollments into correctly-timed, correctly-threaded, throttled action:
a multi-worker-safe scheduler and step executor built on the flagship **manual-first**
model — a human sends the first email, its anchor is captured, and automated follow-ups
thread under it. This is the hardest, highest-risk phase; treat the state machine as
pure and test it exhaustively.

**Builds on.** Phase 5 (sequence/step/enrollment), Phase 4 (adapters + `message` anchor),
Phase 3 (pg-boss).

### New package: `packages/core` (pure, no I/O)

The enrollment **state machine** and scheduling math as pure functions:
`transition(state, event) → { nextState, effects[] }` and `computeSchedule(steps,
settings, from) → times[]`. No DB, no network — just data in, decisions out. The worker
interprets the `effects`; `packages/core` never performs them. This is what makes the
engine testable.

**States:** `active` (advancing/scheduled), `waiting` (in a delay until `next_run_at`),
`waiting_manual` (a manual step is pending a human send), `paused`, `stopped` (manual
terminal), `completed` (ran out of steps), `replied` (stop-on-reply terminal),
`bounced` (hard-bounce terminal).

**Events:** `tick` (due), `manual_sent(anchor)`, `auto_sent`, `reply_received`,
`bounce_received`, `pause`, `resume`, `stop`, `step_failed`.

**Effects (interpreted by the worker):** `scheduleAt(time)`, `createTask(step)`,
`sendAuto(step)`, `captureAnchor(message)`, `terminate(reason)`, `emitEvent(...)`.

### Scheduler & executor (in `apps/worker`)

- **Tick:** a periodic pg-boss job claims due enrollments with `SELECT ... FOR UPDATE
SKIP LOCKED` (so N workers never grab the same enrollment), advances each through
  `transition`, and interprets effects. SKIP LOCKED is the multi-worker safety primitive.
- **Step executor per type:**
  - `wait` → set `next_run_at`, state `waiting`.
  - `task` → create a `task` row for a human; state `waiting` on completion.
  - `manual_email` → state `waiting_manual` + create a "compose" task in the user's
    Today queue. **On human send:** capture the anchor (`Message-ID`/`threadId`) onto the
    enrollment, then schedule the next steps.
  - `auto_email` → render template → **`reserveSendSlot`** → `adapter.send()` as a reply
    threaded under `anchor_message_id` → write `message` → `advance`.
- **`reserveSendSlot(mailbox)`** enforces `daily_cap`, `send_window` (in the mailbox tz),
  and `throttle_seconds`. Make the reservation atomic (a `send_reservation` row or an
  atomic counter within the current window, taken under lock) so concurrent workers can't
  both send past the cap. If no slot, reschedule to the next open window.

### Manual-first mechanics (the flagship)

1. Enrollment hits a `manual_email` step → `waiting_manual`; a task appears in the user's
   Today queue with the (optionally AI-drafted, Phase 8) email pre-filled.
2. User edits and sends from their own mailbox (Phase 4 send path).
3. On send, the RFC `Message-ID` + `threadId` become the enrollment's **anchor**.
4. Subsequent `auto_email` follow-ups are sent as replies with `In-Reply-To`/`References`
   set to the anchor, so they land in the same thread the human started.
5. **"Start follow-up from an existing email"**: let a user point the enrollment at an
   already-sent message as the anchor, beginning automated follow-ups on a real
   human-sent thread.

### Data model

- **`task`** — `id`, `organization_id`, `enrollment_id`, `type` (`compose`/`generic`),
  `due_at`, `status`, `assigned_user_id`, timestamps. Powers the Today queue.
- **`send_reservation`** (or a windowed counter) — mailbox slot accounting for
  cap/window/throttle.
- Extend **`enrollment`**: `anchor_message_id`, `attempt_count`, `last_error`,
  `idempotency_key` per (enrollment, step, attempt).
- **`job_log`** — dead-letter + retry audit (or lean on pg-boss's own tables + Sentry).

### Idempotency, retries, safety

- **Idempotency key** per (enrollment, step, attempt) guards against double-send on retry
  or duplicate tick; combine with provider-side dedupe where available.
- **Retries** with exponential backoff on transient failures; **dead-letter** after N;
  Sentry alert on dead-letter and on any terminal `step_failed`.
- **Exactly-once-ish send:** the reservation + idempotency key + writing `message` before
  ack together make a re-run safe (check "did we already send this step?" before sending).

### Tickets

- **R-060** — `packages/core` state machine + transition/schedule fns (pure, exhaustively
  unit-tested).
- **R-061** — pg-boss scheduler tick with `FOR UPDATE SKIP LOCKED` (the tick half; the
  bootstrap already landed in Phase 3).
- **R-062** — step executor (wait/task/manual_email/auto_email) + `reserveSendSlot`
  (window/cap/throttle) + `advance`.
- **R-063** — idempotency keys + retries + dead-letter + Sentry alerts.
- **R-064** — manual-first mechanics: `waiting_manual` → compose task → on-send anchor
  capture → threaded follow-ups; "start follow-up from existing email."

### Testing

Unit (the bulk): every state × event transition; schedule math across time zones and
window edges; reservation logic at the cap boundary. Integration: a full enrollment run
against test Postgres — manual step creates a task, simulated send captures an anchor,
follow-ups thread under it and respect cap/window/throttle; pause/resume/stop; **two
worker processes** against one queue never double-send (the SKIP LOCKED + idempotency
guarantee); retry → dead-letter path.

### Risks & decisions

This is where correctness bugs hurt most. Guard rails: keep all decision logic pure in
`packages/core`; make the worker a thin interpreter; test transitions exhaustively;
treat timezone/window/throttle math as a single audited module (shared with Phase 5's
preview); never send without a reservation + idempotency check; alarm loudly on
dead-letter. Clock skew across workers → rely on DB `now()`, not process clocks.

### Exit (AC E1–E4, D core)

A manual first email followed by automated, correctly-threaded, throttled follow-ups;
pause/resume/stop works; two workers are safe.

---

## Phase 7 — Replies, bounces, unified inbox

**Goal.** Close the loop: detect replies and bounces on the mailboxes, feed them to the
engine (stop-on-reply, suppress-on-bounce), and give users a unified inbox to read and
respond.

**Builds on.** Phase 6 (engine transitions), Phase 4 (`message` anchor store + adapters).

### Data model

- **`suppression`** — `id`, `organization_id`, `value` (email; optionally domain),
  `reason` (`bounce`/`unsubscribe`/`manual`/`complaint`), `created_at`. Checked by the
  engine before every send.
- **Extend `message`** for inbound: `direction = inbound`, `bounce_type`
  (`hard`/`soft`/none), `dsn jsonb`, `in_reply_to`/`references` for matching, and a
  `thread_id`/link back to the enrollment.

### Mechanics

- **Inbound poller (worker job `mailbox.poll`):** per mailbox, poll for new inbound mail —
  Gmail (history/messages since a stored cursor), Microsoft Graph (delta queries), IMAP
  (for SMTP mailboxes). Store a per-mailbox cursor; dedupe by provider message id.
- **Thread matching:** match inbound `In-Reply-To`/`References` against the
  `message_id_header` anchors (indexed in P4) to find the enrollment/prospect. Normalize
  Message-IDs across providers (angle brackets, casing).
- **Bounce/DSN parsing:** detect delivery-status notifications (multipart/report,
  RFC 3464 status codes, provider-specific bounce formats). Classify hard vs. soft.
- **Engine wiring:** a matched **reply** emits `reply_received` → per sequence
  `stop_on_reply`, transition to `replied`/`stopped`. A **hard bounce** emits
  `bounce_received` → `bounced` terminal + add `suppression` for the address. Distinguish
  auto-replies/OOO from genuine replies (heuristics/headers) so vacation responders don't
  falsely stop sequences — make the behavior configurable.

### UI

Unified inbox: list with filters (unread, replied, bounced, by sequence/mailbox), thread
view (the full outbound+inbound conversation via the anchor), reply composer (sends
through the same Phase 4 path, threaded), and a sentiment/triage tag (simple heuristic
now; AI-assisted in Phase 8).

### Tickets

- **R-070** — inbound poller (Gmail/Graph/IMAP) + thread matching + bounce/DSN parsing.
- **R-071** — stop-on-reply / suppress-on-bounce transitions wired to the engine.
- **R-072** — unified inbox UI (filters, thread view, reply composer) + triage tag.

### Testing

Unit: Message-ID normalization + thread matching; DSN/bounce classification across a
corpus of real-world bounce samples; auto-reply detection. Integration: seed an
outbound anchor → inject a matching inbound reply → enrollment stops; inject a hard bounce
→ enrollment terminates + suppression added → next send is skipped.

### Risks & decisions

Thread matching is the crux — provider Message-ID quirks break naive matching; build a
bounce-sample corpus (formats vary wildly); polling cadence vs. cost vs. freshness;
Gmail history-id expiration and Graph delta-token lifecycle (handle re-sync); OOO/auto-
reply false positives; idempotent inbound processing (replayed polls mustn't double-stop).

### Exit (AC G1–G4, I3)

Replies appear in the inbox and stop their sequences; hard bounces suppress the address
and terminate the enrollment.

---

## Phase 8 — AI research & generation

**Goal.** Generate grounded, value-prop-mapped emails a human reviews before sending —
research a prospect (CRM + web), map to your value props, generate with structured
output, humanize via the existing skill, and surface a draft→edit→approve review UI.

**Builds on.** Phase 2 (prospect/company), Phase 6 (manual-first compose task is where
drafts appear), the `cold-email-humanizer` skill (already built).

### New package: `packages/ai`

Provider-agnostic **model** and **search** interfaces (wrap the AI SDK; providers
Anthropic/OpenAI behind one interface; a web-search/fetch provider for research). Uses
`generateObject` with **Zod schemas** for structured, validated generation (retry on
schema-parse failure).

### Data model (pgvector is already available)

- **`research_profile`** — `id`, `organization_id`, `prospect_id`, `sources jsonb`
  (with provenance + fetched-at), `summary`, `signals jsonb`, `embedding vector`,
  `fresh_until`, timestamps. TTL-based freshness so research is cached, not re-run per
  email.
- **`value_prop`** — `id`, `organization_id`, `title`, `body`, `tags`, `embedding vector`.
  CRUD-managed library.
- **`generation`** — `id`, `organization_id`, `prospect_id`/`enrollment_id`/`step_id`,
  `variant` (A/B), `prompt jsonb`, `output`, `model`, `humanized` (bool), `status`
  (`draft`/`approved`/`discarded`), timestamps. Audit + review state.

### Mechanics

- **Research pipeline (`ai.research` job):** gather CRM fields + web results (search →
  fetch → extract), summarize + extract signals via the model, embed, and store with a
  freshness TTL. Always keep **sources/provenance** for grounding and to show reviewers.
- **Generation:** prompt builder pulls the research profile + retrieves relevant
  `value_prop`s via pgvector similarity, then `generateObject` produces a structured
  email (subject + body + rationale) validated against a Zod schema. Generate A/B variants
  when the step asks.
- **Humanize:** pipe the draft through the `cold-email-humanizer` skill (spintax,
  humanization, spam-lint) before it reaches the reviewer.
- **Review UI:** draft → edit → approve, embedded in the manual-first compose task
  (Phase 6) and in sequence step editors (Phase 5's `ai_generate` flag triggers it). A
  human always approves before send.

### Tickets

- **R-080** — `packages/ai`: provider-agnostic model + search interfaces.
- **R-081** — research pipeline → `research_profile` (CRM + web) with sources + freshness.
- **R-082** — value-prop library CRUD; prompt builder; `generateObject` structured gen.
- **R-083** — integrate `cold-email-humanizer` (spintax/humanize/spam-lint); A/B variant
  gen.
- **R-084** — review UI (draft→edit→approve) in compose + sequence steps.

### Testing

Unit: schema validation of generated objects (+ retry-on-invalid), prompt assembly,
pgvector retrieval ranking, humanizer integration. Integration/eval: a golden-set of
prospects → generations graded for grounding (claims traceable to sources), value-prop
mapping, and spam-lint pass. Cost/latency guardrail tests (research cache hits).

### Risks & decisions

Grounding/hallucination — require citeable sources + freshness TTL, never send un-
reviewed; **prompt-injection from scraped web content** (treat fetched text as untrusted;
constrain via the schema + system prompt); structured-output reliability (schema +
bounded retries); cost control (cache research, cap tokens); pgvector index choice
(hnsw vs. ivfflat) and embedding-model consistency; provider abstraction so you can swap
models.

### Exit (AC F1–F4, E1 AI-assist)

Generate a grounded, value-prop-mapped email that a human can review, edit, and send.

---

## Phase 9 — CRM write-back & analytics

**Goal.** Push Quiksend activity back to the CRM (log sends/replies, upsert contacts,
write status), and give users analytics: per-sequence funnels, per-step rates, A/B
comparison, per-mailbox volume/bounce.

**Builds on.** Phase 3 (Nango connections + mapping), Phase 6/7 (send/reply events).

### Data model

- **`crm_writeback_log`** — `id`, `organization_id`, `crm_connection_id`, `event_type`
  (`send`/`reply`/`status`), `entity` (prospect/message), `external_ref`, `status`,
  `idempotency_key`, timestamps. Prevents double-logging on retry.
- **Analytics** — start with SQL aggregate **views** over `enrollment`/`message`/
  `sequence_step`; if they get slow, add periodically-refreshed **rollup tables**
  (`sequence_stats`, `step_stats`, `mailbox_stats`) updated by a `analytics.rollup` job.

### Mechanics

- **Write-back (`crm.writeback` job):** on key engine/inbox events, log an activity
  (Salesforce Task / HubSpot Engagement) and upsert the contact + status via **Nango
  action/proxy**. Idempotent via `idempotency_key` + `crm_writeback_log` (a replayed
  event must not create a second Task). Respect CRM rate limits (Nango proxy helps;
  queue + backoff).
- **Analytics:** funnel per sequence (enrolled → contacted → replied → bounced →
  completed), per-step send/reply/bounce rates, A/B compare (variant A vs. B outcomes
  with basic significance framing), per-mailbox volume + bounce rate (a deliverability
  early-warning). Dashboards in `apps/web` (charts via the stack's charting lib).

### Tickets

- **R-090** — activity logging on send/reply (SF Task / HS Engagement) via Nango.
- **R-091** — contact upsert + status write-back on key events.
- **R-092** — analytics: per-sequence funnel, per-step rates, A/B compare, per-mailbox
  volume/bounce.

### Testing

Unit: event → write-back payload mapping; idempotency (replayed event → single log).
Integration: simulated send/reply → correct `crm_writeback_log` + (mocked Nango) action;
analytics queries return correct counts on seeded data. Live smoke: activity appears in a
SF/HS sandbox.

### Risks & decisions

Write-back idempotency (the main hazard — dedupe on a stable key); CRM rate limits +
partial failures (queue, retry, don't block the engine); status-field mapping per CRM;
analytics query performance (index for the aggregates; move to rollups before they hurt);
honest A/B stats (don't over-claim significance on small n).

### Exit (AC H1–H3, J1–J3)

The CRM reflects Quiksend activity (logged tasks/engagements, updated status), and the
analytics dashboards populate from real runs.

---

## Phase 10 — Public API, webhooks, hardening

**Goal.** Let third parties drive Quiksend programmatically (API-key REST + outbound
webhooks), finish compliance (unsubscribe end-to-end), and harden for real use (rate
limits, tenancy guard, load test, self-host docs).

**Builds on.** Phase 1 (`apiKey` plugin), Phases 2/5/6 (prospects/enroll/analytics),
Phase 4 (compliance footer/headers), Phase 7 (suppression).

### Data model

- **`api_usage`** — per-key request accounting for rate limits + observability.
- **`webhook_endpoint`** — `id`, `organization_id`, `url`, `secret`, `events[]`,
  `status`. **`webhook_delivery`** — attempts, response, status, next-retry (delivery
  log).
- **`unsubscribe_token`** — signed token ↔ (prospect, org) for one-click unsubscribe
  links.

### Mechanics

- **Public REST API (`/api/v1/*`):** authenticated by the **`apiKey` plugin** (keys scope
  to an org). Endpoints: prospects (list/create/update), enroll (add prospect to
  sequence), analytics (read). Per-key **rate limiting** (token bucket; `api_usage`).
  Versioned, documented (OpenAPI).
- **Outbound webhooks:** on events (reply, bounce, enrollment state change), deliver
  **HMAC-signed** payloads to registered endpoints via a `webhook.deliver` job with
  retries + a delivery log; signature lets receivers verify authenticity; guard against
  replay (timestamp + nonce).
- **Unsubscribe end-to-end:** the `List-Unsubscribe` header + footer link (from Phase 4)
  resolve to a handler that validates the `unsubscribe_token`, writes a `suppression`,
  and triggers CRM status write-back (Phase 9). Compliant footers (physical address +
  clear opt-out) enforced on all sends.
- **Security/hardening pass:** global + per-key rate limits; a **tenancy CI guard** (a
  test/lint asserting every org-scoped query filters by `organization_id` — codify the
  invariant so a missing filter fails CI); secret review; **load-test the scheduler**
  (drive many concurrent enrollments across workers; confirm SKIP LOCKED + caps hold
  under load); self-host `docker-compose` (app + worker + Postgres + Mailpit) + a seed
  script; docs.

### Tickets

- **R-100** — public REST API (`/api/v1/*`) with apiKey auth (prospects, enroll,
  analytics read) + per-key rate limits.
- **R-101** — outbound webhooks (HMAC, retries, delivery log).
- **R-102** — suppression/unsubscribe end-to-end (link → handler → suppress → CRM) +
  compliance footers.
- **R-103** — security pass (rate limits, tenancy CI guard, secret review) + scheduler
  load test + self-host docker-compose + seed + docs.

### Testing

Unit: HMAC sign/verify, unsubscribe-token validation, rate-limit accounting. Integration:
API key scoped to org A can't touch org B (tenancy); webhook delivery + retry + signature
verified by a test receiver; unsubscribe link → suppression → next send skipped. Load:
scheduler throughput + correctness under concurrency (no double-send, caps respected).

### Risks & decisions

API tenancy (key→org scoping is the security boundary — test it hard); rate-limit
fairness; webhook security (HMAC + replay protection + SSRF care on endpoint URLs);
unsubscribe compliance (CAN-SPAM/GDPR — one-click, honored promptly, logged); load-test
realism (model real send patterns); self-host completeness (someone should go zero→running
from the docker-compose + docs alone).

### Exit (AC I1–I2, K1–K2)

A third party drives Quiksend via the API; unsubscribe/compliance is verified end-to-end;
the self-host story works from the documented compose + seed.

---

## Appendix A — Recommended sequencing adjustments

1. **Pull the pg-boss bootstrap forward to Phase 3** (worker process + handler registry +
   schema install), leaving only the _scheduler tick_ and _step executor_ in Phase 6.
   Phase 3's webhook/sync processing and Phase 4's send both want async work; standing the
   queue up once, early, avoids interim inline hacks. (Phases above assume this.)
2. **Extract the schedule/window/throttle math into `packages/core` when Phase 6 lands,
   and have Phase 5's schedule preview import it** — one function, so preview never drifts
   from reality. Until then, label the preview an estimate.
3. **Design `message` (Phase 4) for inbound from day one** (nullable bounce/DSN/thread
   fields) so Phase 7 extends rather than migrates it heavily.

## Appendix B — Cross-cutting risk register

| Risk                                                      | Phase(s) | Mitigation                                                                                        |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Tenant data leakage                                       | all      | `orgFn` chokepoint + a tenancy CI guard (R-103) + per-table tenancy tests                         |
| Double / runaway sends                                    | 6        | reservation + idempotency key + SKIP LOCKED + provider dedupe                                     |
| Thread matching failures                                  | 4, 7     | normalize Message-IDs; index anchors; bounce/reply sample corpus                                  |
| Dedupe drift (CSV vs CRM)                                 | 2, 3     | single email/domain natural key + explicit merge precedence                                       |
| External API drift (Nango, Gmail, Graph, pg-boss, AI SDK) | 3,4,6,8  | thin adapter layer per provider; verify current APIs at build; live smoke tests                   |
| AI hallucination / injection                              | 8        | sources + freshness TTL; treat scraped text as untrusted; schema-validated output; human approval |
| Compliance (unsubscribe/bounce)                           | 7, 10    | suppression checked before every send; one-click unsubscribe; compliant footers                   |
| Scheduler under load                                      | 6, 10    | load test; caps/windows enforced atomically; dead-letter + Sentry alarms                          |

## Appendix C — Definition of Done (per ticket, restated)

`pnpm check` green · migration reviewed + reversible · org-scoping enforced and covered by
a tenancy test · Sentry on new server fns/jobs · pino logs carry `organization_id` + entity
id · external calls behind an adapter with a fake for unit tests · docs/README/RELEASING
updated when operationally relevant · Conventional-Commit PR title so Release Please
versions it.
