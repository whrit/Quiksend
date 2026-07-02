# Performance Review Findings

## Summary

- Files reviewed: 35+ (scheduler, reservation, analytics, inbox, prospects, CRM writeback, webhooks, mailbox poll, AI/pgvector, CSV import, schema indexes, queue/turbo config)
- Critical: 1, High: 6, Medium: 9, Low: 4
- Overall: **needs-fixes** — core engine patterns (SKIP LOCKED, advisory locks) are sound, but several read paths and batch jobs lack indexes or throughput headroom for 100k-row scale. Analytics rollups exist as a view but are unused; there is no automated signal for when to materialize them.

---

## Findings

### 1. Scheduler hot path

#### [PERF-001] Tick claim query is indexed; partial index would help at scale
- Location: `apps/worker/src/sequence/tick.ts:9-15`, `packages/db/src/schema/sequences.ts:127`
- Severity: low
- What: Claim uses `WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now() ORDER BY next_run_at LIMIT 100 FOR UPDATE SKIP LOCKED`. Index `enrollment_state_next_run_idx` on `(state, next_run_at)` exists and supports this pattern.
- Impact: At 100k active enrollments with a small due subset, planner can index-scan active rows ordered by `next_run_at`. A partial index `WHERE state = 'active' AND next_run_at IS NOT NULL` would shrink the index at very large active counts.
- Fix: Optional partial index if `pg_stat_user_indexes` shows heavy scans on the full `(state, next_run_at)` index.
- Confidence: high

#### [PERF-002] Batch size 100 + 30s tick caps scheduler drain at ~3.3 enrollments/sec
- Location: `apps/worker/src/sequence/tick.ts:13`, `apps/worker/src/sequence/register.ts:12`
- Severity: medium
- What: Tick runs every 30 seconds (`*/30 * * * * *`) and claims at most 100 enrollments per invocation. Post-claim, `enqueueSequenceStep` runs sequentially in a loop (`tick.ts:23-25`).
- Impact: Theoretical max ~200 enrollments/min (~3.3/sec) from the tick alone. A burst of 100k simultaneously due enrollments would take ~8.3 hours to fully enqueue (`100000 / (100/30)`). Normal steady-state (caps/throttles spread sends) is fine; bulk re-enrollment or clock skew could create multi-hour backlog.
- Fix: Raise `LIMIT` dynamically or run tick more frequently under backlog (e.g. claim until empty or queue depth threshold). Parallelize `enqueueSequenceStep` calls (they are idempotent via `singletonKey` in `idempotency.ts:30-33`).
- Confidence: high

#### [PERF-003] Per-row UPDATE inside claim transaction extends lock hold time
- Location: `apps/worker/src/sequence/tick.ts:17-20`
- Severity: medium
- What: After `SELECT … FOR UPDATE SKIP LOCKED`, the loop runs one `UPDATE enrollment SET next_run_at = NULL` per claimed row inside the same transaction.
- Impact: 100 sequential updates per tick extend transaction duration and row lock lifetime. Under concurrent workers this is usually fine (SKIP LOCKED), but it adds latency to the claim phase.
- Fix: Single `UPDATE … WHERE id = ANY($1)` or `UPDATE … FROM unnest` batch update.
- Confidence: high

---

### 2. Reservation contention

#### [PERF-004] Advisory lock serializes per mailbox — acceptable but latency stacks under burst
- Location: `apps/worker/src/sequence/reserve-slot.ts:86-87`
- Severity: medium
- What: `pg_advisory_xact_lock(hashtext(mailboxId))` serializes all reservation attempts for one mailbox. Inside the lock: mailbox load, window check, `lastSendAt`, `countReservationsInWindow`, optional `oldestReservationTime`, insert (`:98-124`).
- Impact: 100 concurrent enrollments on the same mailbox queue behind one lock. Each transaction is ~3–5 queries; at ~20–50ms/txn, tail latency for the 100th waiter is ~2–5s. Correct for cap enforcement; painful for hot mailboxes during large sequence launches.
- Fix: Expected behavior for correctness. Mitigate by staggering enrollments, sharding across mailboxes, or pre-computing next slot outside the lock (harder). Monitor p95 reservation time per mailbox.
- Confidence: high

#### [PERF-005] Rolling 24h cap count uses `reserved_at`, but index is on `window_start`
- Location: `apps/worker/src/sequence/reserve-slot.ts:45-57`, `packages/db/src/schema/tasks.ts:74`
- Severity: high
- What: Cap check: `COUNT(*) … WHERE mailbox_id = $1 AND reserved_at >= $windowStart AND status IN ('held','sent')`. Index: `send_reservation_mailbox_window_idx` on `(mailbox_id, window_start)`.
- Impact: Query filter column (`reserved_at`) does not match index column (`window_start`). At high send volume (thousands of reservations/mailbox/day), cap checks become sequential scans or inefficient index use — inside the advisory lock, amplifying contention.
- Fix: Add `(mailbox_id, reserved_at)` index (optionally include `status`), or rewrite count to filter on `window_start >= $windowStart` if semantically equivalent.
- Confidence: high

#### [PERF-006] `lastSendAt` lacks a targeted composite index
- Location: `apps/worker/src/sequence/reserve-slot.ts:29-41`, `packages/db/src/schema/mail.ts:107-112`
- Severity: medium
- What: Throttle check queries `message` with `(mailbox_id, organization_id, direction='outbound', status='sent') ORDER BY sent_at DESC LIMIT 1`. Closest index is `message_mailbox_list_idx` on `(organization_id, mailbox_id, direction, sent_at DESC)` without `status`.
- Impact: Postgres can use the index and filter `status = 'sent'`; at 100k+ messages per mailbox, extra heap filters add cost inside every reservation attempt.
- Fix: Partial index `(mailbox_id, sent_at DESC) WHERE direction = 'outbound' AND status = 'sent'`.
- Confidence: medium

---

### 3. Analytics query performance

#### [PERF-007] Funnel query uses correlated EXISTS without `message.enrollment_id` index
- Location: `apps/web/src/lib/analytics.functions.ts:17-33`, `packages/db/src/schema/mail.ts:71-122`
- Severity: high
- What: `getSequenceFunnel` counts enrollments with `EXISTS (SELECT 1 FROM message m WHERE m.enrollment_id = e.id …)`. `message.enrollment_id` has no index.
- Impact: At 100k messages and 10k+ enrollments per sequence, each enrollment row probes `message` — potentially O(enrollments × messages). Dashboard load times of seconds to tens of seconds.
- Fix: Index `message(enrollment_id)` or `(organization_id, enrollment_id, direction, status)`. Prefer querying `sequence_stats` view (`writeback.ts:85-112`) once indexed.
- Confidence: high

#### [PERF-008] `sequence_stats` rollup view exists but analytics bypasses it
- Location: `packages/db/src/schema/writeback.ts:84-112`, `apps/web/src/lib/analytics.functions.ts:6-42`
- Severity: medium
- What: Phase 9 added `sequence_stats` view with same EXISTS pattern. `getSequenceFunnel` recomputes raw aggregates; nothing reads the view.
- Impact: Every funnel request pays full aggregate cost. View is not materialized, so it would still be slow without indexes — but centralizing would simplify adding a materialized table + refresh job later.
- Fix: Route funnel/overview to `sequence_stats` (or materialized table). Schedule `analytics.rollup` job as Phase 9 follow-up (`wave4/briefs/phase-9-crm-writeback-analytics.md:102-104`).
- Confidence: high

#### [PERF-009] `event(organization_id, type, created_at DESC)` index confirmed
- Location: `packages/db/src/schema/writeback.ts:76-80`, `apps/web/src/lib/analytics.functions.ts:262-295`
- Severity: low (positive)
- What: Index matches `getWorkspaceOverview` filters on `(organization_id, type)` + `created_at >= weekAgo` and daily trend grouped by day.
- Impact: Workspace overview and reply counters should scale to 100k+ events with index scans.
- Fix: None required. Ensure `getSequenceEventTimeline` (`analytics.functions.ts:331-337`) gets a GIN/expression index if used heavily — it filters `payload->>'sequenceId'` with no index today.
- Confidence: high

#### [PERF-010] No instrumentation to decide when to add rollup tables
- Location: `apps/web/src/lib/analytics.functions.ts:6-312`, `packages/db/src/schema/tasks.ts:77-91`, `apps/worker/src/sequence/effects.ts:363-388`
- Severity: medium
- What: Phase 9 deferred materialized rollups “if views get slow.” `job_log` records `durationMs` for `sequence.step` only (`execute-step.ts:24-65`). Analytics server fns have no timing logs, slow-query alerts, or pg_stat monitoring hooks.
- Impact: Teams will not know when funnel queries cross a latency threshold until users complain.
- Fix: Wrap analytics handlers with duration logging (OpenTelemetry span or `job_log`-style row), alert on p95 > 2s, or expose `pg_stat_statements` in prod. Add acceptance test benchmark at 100k synthetic rows.
- Confidence: high

#### [PERF-011] Step rates query joins enrollment × message without enrollment sequence index
- Location: `apps/web/src/lib/analytics.functions.ts:62-81`, `packages/db/src/schema/sequences.ts:121-129`
- Severity: medium
- What: `getSequenceStepRates` LEFT JOINs `enrollment` on `sequence_id` + filters `current_step_index >= step_index`, then JOINs `message` on `enrollment_id`.
- Impact: No index on `(organization_id, sequence_id)` for enrollment (only unique `(org, sequence, prospect)`). Large sequences → hash joins + missing `message.enrollment_id` index (PERF-007).
- Fix: Index `enrollment(organization_id, sequence_id)`; same message index as PERF-007.
- Confidence: high

---

### 4. Inbox list query

#### [PERF-012] Inbox thread list over-fetches 500 messages then groups in memory
- Location: `apps/web/src/lib/inbox.functions.ts:95-200`
- Severity: medium
- What: `listInboxThreads` loads up to 500 messages (`limit: 500`), groups into threads in JS, then paginates to `data.limit` (default 50). Not N+1 — batch fetches mailboxes, prospects, enrollments, sequences via `inArray` (`:101-147`).
- Impact: Every inbox page load reads 500 message rows + up to 4 related batch queries. At 100k messages, repeated full scans if filters don't match indexes (e.g. `sequenceId` subquery on enrollment without `(org, sequence_id)` index).
- Fix: SQL `DISTINCT ON (thread_key)` or window function to fetch only latest-per-thread with `LIMIT`. Index enrollment `(organization_id, sequence_id)` and `(organization_id, state)` for filter subqueries (`:68-92`).
- Confidence: high

#### [PERF-013] Inbox ordering uses expression not covered by index
- Location: `apps/web/src/lib/inbox.functions.ts:97`, `packages/db/src/schema/mail.ts:116-120`
- Severity: low
- What: `ORDER BY coalesce(received_at, sent_at)` while `message_inbox_list_idx` is `(organization_id, direction, received_at DESC)`.
- Impact: Outbound-heavy thread views may sort in memory. Inbound-first filters use the index.
- Fix: Generated column `thread_at = coalesce(received_at, sent_at)` + index, or separate queries per direction.
- Confidence: medium

---

### 5. Prospect table query

#### [PERF-014] Keyset cursor always uses `created_at`, ignoring `sortField`
- Location: `apps/web/src/lib/prospects.functions.ts:251-282`
- Severity: high
- What: Pagination cursor predicates always compare `created_at` and `id` (`:251-270`), but `orderBy` uses `sortColumn(data.sortField)` (`:204-214`, `:282`).
- Impact: Sorting by email/name/status with cursor pagination returns wrong pages (correctness + perf). Index cannot be used consistently for non-`createdAt` sorts.
- Fix: Cursor payload must include the sort key; composite indexes per sort mode, e.g. `(organization_id, created_at DESC, id)`, `(organization_id, email, id)`.
- Confidence: high

#### [PERF-015] Missing index for default prospect list sort
- Location: `packages/db/src/schema/prospects.ts:91-98`, `apps/web/src/lib/prospects.functions.ts:273-283`
- Severity: medium
- What: Default sort `(created_at DESC, id DESC)` with filter `organization_id` + `deleted_at IS NULL`. Indexes: `prospect_org_status_idx (org, status)`, unique `(org, email)` — none on `(organization_id, created_at DESC, id)`.
- Impact: At 100k prospects, listing without status filter → sort on large org partition. ~100–500ms+ depending on hardware.
- Fix: Index `(organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`.
- Confidence: high

#### [PERF-016] ILIKE search has no trigram/GiST support
- Location: `apps/web/src/lib/prospects.functions.ts:236-244`
- Severity: medium
- What: Search uses `ilike(email|first_name|last_name, '%term%')` — leading wildcard prevents btree use.
- Impact: Every search scans all org prospects. Unusable past ~50k rows per org.
- Fix: `pg_trgm` GIN indexes on `email`, `first_name`, `last_name`, or dedicated search vector (`tsvector`).
- Confidence: high

---

### 6. CRM writeback throughput

#### [PERF-017] No queue-level retry/backoff for failed writebacks; provider retry only
- Location: `apps/worker/src/handlers/crm-writeback.ts:278-295`, `packages/queue/src/boss.ts:45-54`, `packages/integrations/src/writeback/hubspot.ts:43-44`
- Severity: medium
- What: `crm.writeback` enqueued via plain `enqueue()` (no `retryLimit`/`retryBackoff`). Handler sets log `status: 'failed'` and rethrows. Nango calls use `retries: 3, retryOn: [429, …]` per request.
- Impact: HubSpot ~100–190 req/10s per token; Salesforce limits vary by edition. A burst of sends (1000 messages → 1000 writebacks) can hit 429s; after 3 Nango retries the job fails permanently with no pg-boss retry. Effective throughput bounded by provider limits with no global rate limiter across connections.
- Fix: Add pg-boss `retryLimit` + exponential backoff on `crm.writeback`; per-connection token bucket; batch activities where APIs allow.
- Confidence: medium

#### [PERF-018] Each writeback job loads context with multiple sequential queries
- Location: `apps/worker/src/handlers/crm-writeback.ts:46-119`, `220-261`
- Severity: low
- What: Handler resolves connection, prospect, enrollment, contact ID through separate queries before one Nango call.
- Impact: ~4–6 DB round-trips per writeback — fine at moderate volume; adds DB load at thousands/min.
- Fix: Single JOIN query or cached connection/prospect lookup for hot paths.
- Confidence: medium

---

### 7. Webhook delivery throughput

#### [PERF-019] Sweep every 60s, 50 rows per sweep, no global HTTP concurrency cap
- Location: `apps/worker/src/handlers/webhook-fanout.ts:75-79`, `apps/worker/src/handlers/webhook-deliver.ts:46-59`, `packages/queue/src/boss.ts:71-76`
- Severity: medium
- What: `setInterval(60_000)` calls `sweepPendingWebhookDeliveries(50)`. New deliveries enqueue immediately on fanout (`webhook-fanout.ts:43`). Handler uses `fetch` with 30s timeout (`webhook-deliver.ts:87-97`). pg-boss `work()` uses default team size (typically 2 concurrent jobs per queue per worker process).
- Impact: Retry backlog drains at ≤50/min from sweep plus active queue depth. Burst fanout (100 events × 5 endpoints = 500 HTTP jobs) processes ~2 at a time per worker — minutes to drain. No org-level or global cap to protect worker or recipient endpoints.
- Fix: Configurable sweep interval/limit; explicit `teamSize` on `webhook.deliver`; optional per-endpoint concurrency limit.
- Confidence: medium

---

### 8. pgvector queries

#### [PERF-020] HNSW index present (1536-dim); redundant prefetch before vector search
- Location: `packages/db/src/schema/ai.ts:40-52`, `packages/ai/src/generation/prompt-builder.ts:19-57`
- Severity: medium
- What: `value_prop.embedding` is `vector(1536)` with `value_prop_embedding_hnsw_idx` using `hnsw` + `vector_cosine_ops`. `retrieveValueProps` first loads 50 rows via `findMany` (`:19-22`), then runs cosine query (`:44-57`) if embedding exists.
- Impact: Extra round-trip and 50-row fetch on every generation; vector query itself should be fast (<50ms) with HNSW at reasonable corpus sizes. Wasted work dominates cold path.
- Fix: Remove upfront `findMany`; rely on vector query + org filter. Consider org-scoped partial indexes at scale.
- Confidence: high

#### [PERF-021] HNSW index not scoped by organization
- Location: `packages/db/src/schema/ai.ts:50-53`, `packages/ai/src/generation/prompt-builder.ts:54-55`
- Severity: low
- What: HNSW index is on `embedding` alone; query filters `organization_id` after index scan.
- Impact: Fine for hundreds of value props per org; at multi-tenant scale with 100k+ vectors globally, recall scan may touch more nodes than necessary.
- Fix: Partition by `organization_id` or use partial indexes per large tenant.
- Confidence: medium

---

### 9. Mailbox poll

#### [PERF-022] All active mailboxes enqueued every 2 minutes — rate-limit risk at 100+ mailboxes
- Location: `apps/worker/src/handlers/mailbox-poll.ts:57-65`
- Severity: medium
- What: Cron `*/2 * * * *` loads all active mailboxes and enqueues one `mailbox.poll` job each, sequentially. Gmail uses `history.list` (`:303-311`); full resync caps `maxResults: 50` (`:358`); incremental history has **no pagination** for large history pages.
- Impact: 100 mailboxes → 100 jobs / 2 min → ~0.83 polls/sec average, but tick creates a burst of 100 enqueues. Each Gmail message triggers sequential `fetchGmailRawMessage` (`:333-336`) — N+1 HTTP to Gmail. Gmail API project quotas can be stressed with many mailboxes and large history batches.
- Fix: Stagger polls (shard by `hash(mailbox_id) % N`), paginate `history.list`, batch-fetch messages where API allows. Index `mailbox(status)` if table grows (`mail.ts:62-68` has no status index).
- Confidence: high

#### [PERF-023] Microsoft delta poll does not follow `@odata.nextLink`
- Location: `apps/worker/src/handlers/mailbox-poll.ts:398-460`
- Severity: high
- What: `pollMicrosoft` performs a single GET; processes `data.value` but never follows `@odata.nextLink` for additional pages.
- Impact: Busy inboxes drop messages beyond the first page between polls — functional bug with perf implications (forced full resyncs later).
- Fix: Loop on `nextLink` until exhausted or cap pages per poll.
- Confidence: high

---

### 10. CSV import

#### [PERF-024] 5000-row import runs synchronously with ~3–5 queries per row
- Location: `apps/web/src/lib/prospects.functions.ts:191`, `709-810`, `apps/web/src/lib/prospect-import.ts:208-244`
- Severity: **critical**
- What: Client parses CSV via papaparse stream (`prospect-import.ts:217-242`), capped at 5000 rows (`prospects.functions.ts:191`). `startImport` loops rows calling `importProspectRow` sequentially (`:795-810`) — each does `resolveCompanyId` (1–2 queries), `findFirst` prospect, insert/update (`:709-759`). No batching, no background job.
- Impact: 5000 rows × ~4 queries ≈ 20k DB round-trips in one HTTP request. Expect 30s–several minute handler times, gateway timeouts, and connection pool exhaustion. Not viable at the documented cap.
- Fix: Enqueue `import.process` job; batch upsert prospects/companies (`INSERT … ON CONFLICT` in chunks of 100–500); return batch ID immediately.
- Confidence: high

---

## P2 — Additional items

#### [PERF-025] Prospect timeline is not N+1 (limited data today)
- Location: `apps/web/src/routes/_protected/prospects/$id.tsx:49-115`, `apps/web/src/lib/analytics.functions.ts:341-387`
- Severity: low
- What: Loader runs 2 parallel calls: `getProspect` (single query with relations) and `getProspectWritebackLogs` (3 queries: enrollments, messages, writeback logs — not per-row N+1). Timeline UI is built from prospect `createdAt`/`updatedAt` only (`$id.tsx:98-115`) — no messages/events timeline yet.
- Impact: No N+1 today. When a real activity timeline is added, design for one query over `event`/`message` by `prospect_id`.
- Fix: Plan unified timeline query with `(organization_id, entity_id, created_at)` index on `event`.
- Confidence: high

#### [PERF-026] Missing FK indexes on hot join columns
- Location: `packages/db/src/schema/mail.ts:83`, `packages/db/src/schema/sequences.ts:121-129`
- Severity: high
- What: Columns used in WHERE/JOIN without dedicated indexes:
  - `message.enrollment_id` — funnel, step rates, inbox filters
  - `enrollment(organization_id, sequence_id)` — analytics + inbox subqueries
  - `enrollment(organization_id, state)` — inbox “replied” filter
- Impact: Sequential scans at 100k+ rows on analytics and inbox paths.
- Fix: Add indexes listed above; verify with `EXPLAIN ANALYZE` on production-shaped data.
- Confidence: high

#### [PERF-027] `prepare: false` not configured for PgBouncer compatibility
- Location: `packages/db/src/client.ts:9-13`, `CLAUDE.md:50`
- Severity: medium
- What: Comment documents PgBouncer transaction-mode requirement; client is `postgres(env.DATABASE_URL)` with default `prepare: true`. Same client shared by `apps/web` and `apps/worker`.
- Impact: Enabling a transaction-pooler fronting Postgres will cause prepared-statement errors or subtle bugs. Not an issue on direct Postgres today.
- Fix: `postgres(env.DATABASE_URL, { prepare: false })` when using pooler; or split pooled vs direct URLs per process type.
- Confidence: high

#### [PERF-028] Turbo does not cache `typecheck` outputs
- Location: `turbo.json:3-5`
- Severity: low
- What: `typecheck` task has `dependsOn: ["^typecheck"]` but no `outputs` and no explicit `cache` — Turbo caches tasks with outputs; `tsc --noEmit` produces none.
- Impact: Monorepo `pnpm turbo typecheck` re-runs all packages every time (~acceptable for small repo; slower as packages grow).
- Fix: Add `@quiksend/web#typecheck` cache via `tsc --build` + `.tsbuildinfo`, or accept cold typecheck. `test`/`build` outputs are configured correctly.
- Confidence: high

#### [PERF-029] Recharts imported on route chunks only; no Tremor
- Location: `apps/web/package.json:50`, `apps/web/src/routes/_protected/analytics/index.tsx:11`, `apps/web/src/routes/_protected/sequences/$id/analytics.tsx:2`
- Severity: low
- What: `recharts@3.3.0` is a dependency; used only in analytics/health route files. TanStack Router code-splits by route. No `@tremor` packages in the repo.
- Impact: Recharts (~200KB+ gzipped pre-tree-shake) lands in analytics route chunks, not the main inbox/prospect bundle. Acceptable for V0.
- Fix: Lazy-load chart components with `React.lazy` if bundle analyzer shows regression; consider lighter chart lib if dashboards multiply.
- Confidence: medium

---

## Load estimates (reference)

| Path | ~100k rows | Dominant cost | Expected latency today | At scale without fixes |
|------|------------|---------------|------------------------|-------------------------|
| Scheduler tick | 100k due burst | Claim + enqueue | 30s tick, 100/batch | 8+ hr backlog (PERF-002) |
| Reserve slot | 100 concurrent / mailbox | Advisory lock + COUNT | tens–100s ms | 2–5s tail (PERF-004) |
| getSequenceFunnel | 10k enroll × 100k msg | Correlated EXISTS | 100ms–2s (small data) | 10–60s+ (PERF-007) |
| listInboxThreads | 100k msg | 500-row fetch + group | 50–200ms | 500ms–2s (PERF-012) |
| listProspects | 100k prospects | Seq scan + sort | 100–300ms | 1–5s; search unusable (PERF-015/016) |
| startImport 5000 | 5000 rows | 20k queries sync | N/A (timeout) | Request failure (PERF-024) |
| retrieveValueProps | <500 vectors | HNSW + double fetch | <100ms | OK; wasteful prefetch (PERF-020) |
| Mailbox poll 100 | 100 mailboxes | HTTP burst / 2 min | OK | Quota pressure (PERF-022) |

---

## Recommended priority order

1. **PERF-024** — Move CSV import off the request thread; batch upserts.
2. **PERF-007 / PERF-026** — Index `message.enrollment_id` and `enrollment(organization_id, sequence_id)`.
3. **PERF-005** — Fix `send_reservation` index/query alignment.
4. **PERF-014** — Fix keyset pagination to match sort field.
5. **PERF-002** — Increase scheduler throughput under backlog.
6. **PERF-010** — Add analytics query timing before rollups become urgent.
7. **PERF-023** — Paginate Microsoft Graph delta responses.
