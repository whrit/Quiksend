# Performance Review Findings

## Summary

- Files reviewed: ~28 (gateway-detect handler + mail DNS, canary-check + seed-imap, deliverability snapshot/grid server-fns, reserve-slot/mailbox-router/effects, Phase 11 schema + migrations 0015–0018, import-prospects, canary-send, content-sanitizer, prospects/seed-inbox org fns, deliverability UI, load-test-engine, Wave 5 perf baseline)
- Critical: 0, High: 5, Medium: 7, Low: 5
- Overall: **needs-fixes** — core patterns (domain dedupe, DNS semaphore, snapshot pre-aggregation, per-seed IMAP grouping) are sound, but bulk classification skips the DB cache, IMAP polling scales with inbox volume not canary count, and several index / N+1 gaps will bite at Phase 11 target scale (1k+ canaries, large CSV imports).

## Findings

### [PERF-001] `gateway.detect_bulk` always re-runs DNS — skips `gateway_classification` cache

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:125-129`
- **Severity**: high
- **Confidence**: high
- **What**: Bulk import deduplicates email domains (`Set` on line 126) and respects the 50-wide DNS semaphore, but `classifyDomain()` is invoked unconditionally for every domain. There is no `SELECT` against `gateway_classification` to skip domains whose `ttl_until > now()`.
- **Impact**: Re-importing a 5,000-row CSV with ~500 unique domains triggers ~500 full MX→DMARC→SPF cascades even when every domain is already cached. At 50 concurrent lookups and up to ~15s worst-case per domain (5s MX + unbounded TXT), a single import can saturate worker DNS for minutes and hammer upstream resolvers.
- **Fix**: Before `classifyDomain`, batch-load cached rows (`WHERE email_domain = ANY($1) AND ttl_until > now()`). Only enqueue DNS for cache misses. Mirror the pattern already used in `gateway.apply_classification` (`gateway-detect.ts:170-177`).

### [PERF-002] `gateway.apply_classification` issues up to 5,000 sequential prospect UPDATEs

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:179-200`
- **Severity**: high
- **Confidence**: high
- **What**: After batch-loading cached classifications into a `Map`, the handler loops unclassified prospects and runs one `UPDATE prospect … WHERE id = $1` per row (plus per-row `gateway.detect_single` enqueue for cache misses on line 184).
- **Impact**: A 5,000-prospect import batch capped by `.limit(5000)` (line 162) generates up to 5,000 DB round trips in a single job. At ~2–5ms/UPDATE this adds 10–25s of DB time per apply pass, blocks the pg-boss worker, and amplifies under concurrent imports.
- **Fix**: Replace the per-row loop with domain-scoped bulk updates (the `applyClassificationToProspects` helper at `gateway-detect.ts:56-80` already does this correctly). Enqueue missing domains in one bulk job, not per-prospect `detect_single`.

### [PERF-003] IMAP canary poll scans every message since 24h — not token-targeted

- **Location**: `apps/worker/src/deliverability/seed-imap.ts:70-88`
- **Severity**: high
- **Confidence**: high
- **What**: `searchCanaryMessages` connects, iterates up to 9 folder candidates, runs `client.search({ since })` for all UIDs in the last 24 hours, then `fetchOne` with full `source: true` for every UID until all tokens are found.
- **Impact**: A production seed inbox receiving hundreds of messages/day forces full-body downloads of unrelated mail on every 5-minute poll cycle. With 20 seeds and busy inboxes this becomes sustained IMAP bandwidth + CPU, and poll latency grows linearly with inbox volume rather than pending canary count (spec assumes token/header search).
- **Fix**: Search by custom header (`X-Quiksend-Canary-Id`) or subject suffix `[Q{token}]` via IMAP `HEADER`/`TEXT` criteria; fetch source only for matching UIDs. Early-exit once `tokenSet.size === found.size`.

### [PERF-004] No cap on concurrent IMAP connections per poll cycle

- **Location**: `apps/worker/src/handlers/canary-check.ts:44-48`
- **Severity**: high
- **Confidence**: high
- **What**: Pending canaries are grouped by `seedInboxId`, then `Promise.all` launches one `pollSeed` (each opening a fresh IMAP connection) per seed with no concurrency limit.
- **Impact**: Phase 11 spec caps concurrent IMAP connections at 20 (`Quiksend-Implementation-Plan-Phase-11.md:1379-1381`). With 50+ active seeds (provider pool + workspace seeds), a single `canary.check` tick opens 50+ simultaneous TLS connections — risking provider rate limits, connection refused errors, and worker memory spikes.
- **Fix**: Wrap seed polling in a semaphore (max 20), matching the DNS semaphore pattern in `gateway-detect.ts:83-96`.

### [PERF-005] `gateway.detect_single` bypasses classification cache

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:105-112`, `apps/web/src/lib/prospects.functions.ts:421`
- **Severity**: medium
- **Confidence**: high
- **What**: Single-prospect create/update enqueues `gateway.detect_single`, whose handler calls `classifyDomain()` immediately with no cache lookup or TTL check.
- **Impact**: Every manual prospect add triggers a full DNS cascade even for common domains (`gmail.com`, `microsoft.com`) already classified globally. Low volume individually, but noisy for API/automation clients and redundant with the shared `gateway_classification` table.
- **Fix**: At handler entry, `findFirst` on `gateway_classification` where `email_domain = $domain AND ttl_until > now()`; on hit, call `applyClassificationToProspects` only and return.

### [PERF-006] DMARC/SPF TXT lookups have no timeout (MX has 5s)

- **Location**: `packages/mail/src/dns.ts:46-52`, `packages/mail/src/gateway-detect.ts:266-286`
- **Severity**: medium
- **Confidence**: high
- **What**: `resolveMxRecords` correctly uses `Promise.race` with a 5s timeout (`dns.ts:24-28`). `resolveTxtRecords` delegates to `dns.resolveTxt` with no timeout; `detectEmailGateway` chains DMARC + SPF after MX on cache-miss domains.
- **Impact**: A slow or non-responsive authoritative nameserver can stall a worker slot indefinitely (only MX is bounded). Under the 50-wide semaphore, a handful of stuck TXT lookups can exhaust concurrency and block bulk classification.
- **Fix**: Apply the same `Promise.race` timeout wrapper to `resolveTxtRecords` (5s default, configurable). Treat timeout as lookup failure and proceed/fail fast.

### [PERF-007] Idle seed heartbeat (30 min) and IMAP pooling not implemented

- **Location**: `apps/worker/src/handlers/canary-check.ts:30-48`, `apps/worker/src/deliverability/seed-imap.ts:61-98`
- **Severity**: medium
- **Confidence**: high
- **What**: `canary.check` runs every 5 minutes and only polls seeds that appear in the pending-canary query. Seeds with zero pending canaries are never contacted. Each poll creates a new `ImapFlow` client, connects, and logs out — no persistent pool or 15-minute idle close.
- **Impact**: Matches active-canary polling interval, but misses spec'd idle heartbeat that would catch credential rot / IMAP endpoint failures without waiting for the next canary send. Fresh connect-per-poll adds ~200–500ms TLS handshake overhead per seed per cycle versus pooled connections.
- **Fix**: Track `lastPollAt` per seed; poll idle seeds on a 30-minute cron or secondary schedule. Introduce a per-process IMAP connection pool keyed by `seedInboxId` with idle TTL (15 min) and max 20 connections.

### [PERF-008] Missing `canary_send(sent_at)` index for silent-drop sweep

- **Location**: `apps/worker/src/handlers/canary-check.ts:50-59`, `packages/db/src/schema/deliverability.ts:108-115`
- **Severity**: medium
- **Confidence**: high
- **What**: After polling, a bulk `UPDATE canary_send SET arrival_status = 'silent_drop'` filters `arrival_status = 'pending' AND sent_at < now() - interval '24 hours'`. Schema has partial `canary_send_pending_idx` on `(arrival_status, expected_arrival_at)` and `canary_send_seed_inbox_idx` on `(seed_inbox_id)`, but no index leading with `sent_at`.
- **Impact**: As pending canary rows accumulate (10k+ across orgs), the daily silent-drop sweep scans all pending rows to find stale `sent_at` values. Runs every 5 minutes, so repeated sequential scans add unnecessary DB load.
- **Fix**: Add partial index `(sent_at) WHERE arrival_status = 'pending' AND sent_at IS NOT NULL`, or extend the pending partial index to `(arrival_status, sent_at)`.

### [PERF-009] `maybePauseCampaigns` N+1 — per-row sequence + org metadata fetches

- **Location**: `apps/worker/src/handlers/canary-check.ts:156-191`
- **Severity**: medium
- **Confidence**: high
- **What**: The auto-pause aggregation is a single efficient SQL query (lines 140-154). The follow-up loop, however, calls `db.query.sequence.findFirst` and `loadOrgMetadata` (another org `findFirst`) for every grouped row before `evaluateAutoPause`.
- **Impact**: With many active sequences each running canaries across multiple (mailbox × gateway) tuples, one 5-minute cycle can produce dozens to hundreds of aggregation rows → 2× row count extra queries. At 1,000 active sequences with broad canary coverage this becomes thousands of round trips per cycle after the poll itself completes.
- **Fix**: Batch-load sequences and org metadata for distinct IDs from the aggregation result (two `inArray` queries), cache in `Map`s, then evaluate in memory. Consider moving threshold lookup into SQL via a lateral join on `sequence.canary_config`.

### [PERF-010] Pending-canary query loads all matching rows unbounded

- **Location**: `apps/worker/src/handlers/canary-check.ts:31-41`
- **Severity**: medium
- **Confidence**: high
- **What**: `runCanaryCheck` selects all pending canaries due within 30 minutes (sent in last 24h) with no `LIMIT` or pagination.
- **Impact**: At 10k concurrent pending canaries (large provider pool × many campaigns), each 5-minute tick loads the full result set into worker memory before grouping. Combined with [PERF-003] and [PERF-004], poll cycle duration can exceed the 5-minute cron interval.
- **Fix**: Process in batches (e.g. 500 rows ordered by `expected_arrival_at`), or push grouping into SQL with `DISTINCT seed_inbox_id` first then load tokens per seed.

### [PERF-011] `pickLeastLoadedSafeMailbox` runs N reservation COUNTs inside routing

- **Location**: `apps/worker/src/sequence/mailbox-router.ts:51-72`
- **Severity**: low
- **Confidence**: high
- **What**: When auto-swapping to an enterprise-safe mailbox, the router calls `countReservationsInWindow` once per safe mailbox inside the advisory-locked send transaction path (via `selectMailboxForSend` → `handleSendAuto`).
- **Impact**: Typical workspaces have <5 safe mailboxes, so cost is small (~3 queries × N). If an org marks 15+ mailboxes enterprise-safe, each SEG send adds 15+ counted queries inside the reservation transaction, extending advisory lock hold time.
- **Fix**: Acceptable at current scale. If safe-mailbox counts grow, precompute reservation counts in one grouped query or cache counts outside the lock.

### [PERF-012] Deliverability grid uses O(rows × cols) linear `.find()` on snapshots

- **Location**: `apps/web/src/lib/deliverability.functions.ts:50-78`
- **Severity**: low
- **Confidence**: high
- **What**: Grid data comes from pre-aggregated `deliverability_snapshot` rows (good — no live `canary_send` JOIN). Assembly nests `snapshots.find(...)` for each mailbox × gateway cell (~14 SEG columns).
- **Impact**: With 50 mailboxes and 14 gateways, ~700 linear scans per request — trivial in Node. At 200 mailboxes or if snapshot history grows (multiple `window_start` rows per tuple), cost rises. UI polls every 30s (`deliverability/index.tsx:60`), so unnecessary work repeats.
- **Fix**: Build a `Map<`${mailboxId}:${gateway}`, Snapshot>` once before the nested loop. Also note `refreshDeliverabilitySnapshots` hardcodes a 7-day window (`deliverability-snapshot.ts:35-36`) while the UI offers 14/30-day selectors — wider windows reuse the same 7-day rollup, not a perf bug but limits query selectivity.

### [PERF-013] `seed_inbox` indexes differ from spec — minor list-query gaps

- **Location**: `packages/db/src/schema/deliverability.ts:72-76`, `apps/web/src/lib/seed-inbox.functions.ts:71-79`
- **Severity**: low
- **Confidence**: high
- **What**: Spec asked for `(organization_id, active)` for workspace seed lists and a partial index for provider seeds (`organization_id IS NULL`). Shipped schema has `seed_inbox_org_idx(organization_id)` and `seed_inbox_gateway_active_idx(gateway, active)` separately; provider seed query uses `isNull(organizationId)` with no supporting partial index.
- **Impact**: Workspace seed lists are small (tens of rows). Provider pool queries scan all global seeds — fine at bootstrap scale (dozens), slower if pool grows to hundreds.
- **Fix**: Add `CREATE INDEX … ON seed_inbox (organization_id, active)` and partial `CREATE INDEX … ON seed_inbox (gateway, active) WHERE organization_id IS NULL`.

### [PERF-014] `enterprise_safe` routing filter has no dedicated index

- **Location**: `apps/worker/src/sequence/mailbox-router.ts:39-48`, `packages/db/src/schema/mail.ts:63-66`
- **Severity**: low
- **Confidence**: high
- **What**: `loadSafeMailboxes` filters `organization_id + status='active' + enterprise_safe=true + enterprise_safe_auto_downgraded=false` with no composite index on those columns.
- **Impact**: Mailboxes per workspace are typically <20 (per brief assumption). Sequential scan cost is negligible today. Would matter only if workspaces routinely attach 100+ mailboxes.
- **Fix**: No action needed now. If mailbox counts grow, add partial index `(organization_id) WHERE status = 'active' AND enterprise_safe = true AND enterprise_safe_auto_downgraded = false`.

### [PERF-015] Test suite wall-clock ~56s — import/transform dominates

- **Location**: workspace `pnpm test` (64 files, 292 tests; Duration 56.37s — import 39.12s, tests 9.98s)
- **Severity**: low
- **Confidence**: high
- **What**: Phase 11 added ~10 new test files (gateway-detect, dns, content-sanitizer, auto-pause, mailbox-safety, canary-check, seg-routing integration, reserve-slot/mailbox-router extensions). Total runtime is ~56s vs Wave 6 ~30s CI baseline cited in the brief.
- **Impact**: CI feedback loop nearly doubled, but actual test execution remains ~10s; regression is mostly Vitest module import/transform of new packages (`@quiksend/mail` DNS mocks, IMAP mocks). Not a production runtime issue.
- **Fix**: Consider Vitest `pool: forks` tuning, `deps.optimizer`, or splitting worker integration tests into a separate CI job. Low priority.

### [PERF-016] Load-test canary modes declared but not wired

- **Location**: `scripts/load-test-engine.ts:53-54`, `scripts/load-test-engine.ts:918-934`
- **Severity**: low
- **Confidence**: high
- **What**: `canary-happy-path` and `canary-auto-pause` are valid `--test-mode` values (lines 95-100 adjust args), but the final `switch` only handles `permanent-failure`, `outer-rollback`, and `suppression-during-run`; canary modes fall through to `assertHappyPathInvariants`.
- **Impact**: No production perf impact — dead CLI branches only. Confirms load-test canary paths were deferred as noted in the brief.
- **Fix**: Wire dedicated invariant assertions when load-testing canary flows, or remove unused mode names to avoid confusion.

## Positive observations

- **DNS semaphore and MX timeout match spec**: `DNS_CONCURRENCY = 50` (`gateway-detect.ts:7`) and 5s MX timeout via `Promise.race` (`packages/mail/src/dns.ts:15-28`) are correctly implemented.
- **Bulk import dedupes by domain**: 5,000 prospects on 200 domains → 200 DNS jobs, not 5,000 (`gateway-detect.ts:126`, `import-prospects.ts:248-256`).
- **Cache-before-enqueue in apply path**: `gateway.apply_classification` batch-loads `gateway_classification` and only enqueues `detect_single` for domains absent from cache (`gateway-detect.ts:170-185`).
- **Canary poll groups by seed inbox**: One IMAP session per seed per cycle, not one per canary (`canary-check.ts:43-47`).
- **Grid reads pre-aggregated snapshots**: `getDeliverabilityGrid` queries `deliverability_snapshot` + mailboxes — no per-cell live JOIN across `canary_send` (`deliverability.functions.ts:50-55`). Snapshot refresh uses a single set-based `INSERT … SELECT … GROUP BY` (`deliverability-snapshot.ts:17-61`).
- **Auto-pause core aggregation is one SQL round trip**: The grouped deliverability stats query (`canary-check.ts:140-154`) scales with result cardinality, not sequence count directly.
- **Wave 5 reservation index regression fixed**: EPSILON migration replaced `window_start` index with `(mailbox_id, reserved_at)` (`0014_wave5_epsilon_perf_indexes.sql:16`); Phase 11B added `(mailbox_id, recipient_domain, reserved_at)` for the 5-minute domain gap (`0017_phase11b_routing.sql:2`, used in `reserve-slot.ts:69-87`).
- **SEG domain-gap check is indexed and inside advisory lock is bounded**: Two additional COUNT queries plus INSERT — acceptable overhead vs send correctness (`reserve-slot.ts:137-186`).
- **Content sanitizer avoids full MIME clone**: `sanitizeForSeg` mutates `html`/`text` strings on `BuiltMime`, not assembled MIME; async inlining caps at 100KB per image (`content-sanitizer.ts:17`, `82-128`).
- **Canary sends are true shadow sends**: `materializeCanarySend` sends directly via adapter/SMTP and never calls `reserveSendSlotInTx` — canaries do not consume daily send caps or throttle reservations (`canary-send.ts:21-152` vs `effects.ts:295-306`).
- **`prospect_org_gateway_idx` partial index is correct**: `(organization_id, email_gateway) WHERE email_gateway IS NOT NULL AND deleted_at IS NULL` (`0015_phase11_foundation.sql:11`) matches gateway filter queries in `prospects.functions.ts:279-280` and `organization.functions.ts:97-101`.
- **Deliverability UI adds no Recharts dependency**: Grid page uses table/badge components only (`deliverability/index.tsx`); Recharts remains on pre-existing routes — no Phase 11 bundle regression from chart libraries.
- **`generateEmail` metadata tuple intact**: Phase 11 did not touch AI generation; `generateEmail` still uses `{ model, modelId }` from `getDefaultModel()` (`packages/ai/src/generation/generate-email.ts:17-26`).
