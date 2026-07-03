# Phase 11 Full Review — Consolidated Report

**Target**: Phase 11 (enterprise deliverability) — `v2.1.1..v2.2.1`, 115 files changed, ~15KB net production code
**Reviewers**: Security, Correctness, Architecture, Performance, Testing, Completeness (6 parallel Composer 2.5 agents)
**Date**: 2026-07-02
**Files reviewed**: ~120 spanning packages/mail, packages/core/deliverability, packages/db/schema, apps/web server-fns + routes, apps/worker handlers + sequence engine, 4 Phase 11 migrations, runbooks, load-test script, spec doc

## Overall verdict: **needs-fixes**

Phase 11 ships the shape and skeleton of enterprise deliverability well. The
detection layer (11A) is comprehensive and testable. The routing layer (11B) is
end-to-end and includes a real integration test that proves the enforce-policy
skip path. The canary layer (11C) has all the tables, jobs, and UI plumbing.
Foundation-level architectural invariants from Waves 5–6 are preserved cleanly.

But **11 P1 issues** in the canary pipeline and 11C operations must be fixed
before real Deliverability Pro customers depend on the signal. The theme is
consistent: **the canary system was scaffolded, wired, and merged, but the
signal it produces is not yet trustworthy.** Content mismatch between canaries
and real sends (CR-02), missing bounce detection (CR-03), scale-blocker IMAP
polling patterns (CR-04, CR-05), and completely absent handler-level tests
(CR-10) mean the numbers on the deliverability grid could be inaccurate under
production conditions and CI would not catch it.

The two ops crons (11C.18 health check, 11C.19 legit-usage generator) that the
provider seed pool runbook says exist do not exist in code (CR-09) — the runbook
tells operators to check alerts that never fire.

Four Phase 11 webhook event types are registered in `SUPPORTED_WEBHOOK_EVENTS`
and documented as subscribable, but no code emits them (CR-01) — the marketing
promise of real-time deliverability signals to external systems is not backed by
the fanout wire.

**Nothing critical (data loss / auth bypass / SEG-scale correctness failure) is
broken.** No P0 findings. Zero-tolerance regressions from Waves 5–6 held: mail is
still decoupled from integrations, tenancy chokepoint holds, state machine
purity holds, effect executor is used consistently. **Phase 11 is a shippable
diagnostic feature today**; it becomes a shippable auto-remediation feature
after these fixes land.

## Aggregate counts (post-dedup)

Deduplication merged 11 raw findings into 4 consolidated entries (CR-01, CR-05,
CR-06, CR-11, CR-15, CR-16, CR-18, CR-22, CR-32, CR-37, CR-43). See dedup rules
at the bottom of this report.

| Dimension              | Critical | High   | Medium | Low    | Total  |
| ---------------------- | -------- | ------ | ------ | ------ | ------ |
| Security               | 0        | 0      | 2      | 3      | 5      |
| Correctness            | 0        | 2      | 4      | 2      | 8      |
| Architecture           | 0        | 0      | 1      | 5      | 6      |
| Performance            | 0        | 2      | 5      | 4      | 11     |
| Testing                | 0        | 3      | 7      | 1      | 11     |
| Completeness           | 0        | 3      | 5      | 5      | 13     |
| **Total (raw)**        | **0**    | **10** | **24** | **20** | **54** |
| **Total (post-dedup)** | **0**    | **11** | **16** | **16** | **43** |

Note: raw high count (10) < dedup high count (11) because two low-severity
security findings (SEC-P11-007 P11 concurrent IMAP + SEC-P11-004 webhook events
not wired) merged with high-severity findings from other dimensions and got
elevated per SKILL rule 4 (higher severity wins on conflict).

---

## Critical Findings (0)

None. All Phase 11 P1 invariants that would have data loss or auth bypass
consequences (tenant isolation on new tables, encryption domain split for
provider vs user seeds, admin role gates on policy setters, orgFn chokepoint on
all new server-fns) held cleanly.

## High Findings (11)

The eleven issues below are all fixable in a focused sprint. Ordering roughly by
production impact.

### [CR-01] Phase 11 webhook events registered + documented but never emitted

- **Location**: `packages/db/src/schema/api.ts:26-29`, `apps/worker/src/handlers/webhook-fanout.ts`, `apps/worker/src/sequence/execute-effects.ts:155-191`, `docs/webhooks.md:16-19`, `docs/deliverability.md:227-233`
- **Dimensions**: Completeness (COMP-P11-001), Security (SEC-P11-004), Testing (TEST-015)
- **Description**: Four event types (`enrollment.no_safe_mailbox_for_gateway`,
  `deliverability.canary.arrived`, `deliverability.canary.silent_drop`,
  `gateway.detected`) appear in `SUPPORTED_WEBHOOK_EVENTS`, the webhooks
  settings UI dropdown, and `docs/webhooks.md`. Repo-wide search finds no
  `insertDomainEventAndFanout` / `fanoutWebhookEvent` calls for any of them.
  `handleEmitEvent` persists `enrollment.no_safe_mailbox_for_gateway` to the
  `event` table but returns without fanout. `canary-check.ts` inserts internal
  event type `canary.silent_drop_detected` (not the registered
  `deliverability.canary.silent_drop`). `gateway.detected` and
  `deliverability.canary.arrived` never get inserted anywhere.
- **Impact**: External integrations subscribing to Phase 11 events receive
  nothing. Marketing docs advertise real-time signals that don't reach
  subscribers. Docs and OpenAPI advertise capabilities that don't exist.
- **Fix**: Wire `insertDomainEventAndFanout` in `canary-check.ts`
  (`applyCanaryMatches` emits `deliverability.canary.arrived`; the 24h sweep
  emits `deliverability.canary.silent_drop`), in `execute-effects.ts` after
  `no_safe_mailbox` emit, and in `gateway-detect.ts` after prospect
  reclassification. Rename `canary.silent_drop_detected` → `deliverability.canary.silent_drop`
  or add an event-type alias. Verify payloads are org-scoped only (no seed IMAP
  config, no provider pool identifiers).

### [CR-02] Canary sends skip SEG content sanitizer — deliverability signal diverges from real sends

- **Location**: `apps/worker/src/deliverability/canary-send.ts:74-76`, `apps/worker/src/sequence/effects.ts:358-371`
- **Dimensions**: Correctness (CORR-001)
- **Description**: `handleSendAuto` runs `sanitizeForSeg()` (strip tracking
  pixels, external images, prefer plain text) on real SEG-destined sends per
  workspace policy. `materializeCanarySend()` renders the same step template
  but never calls the sanitizer — canaries carry raw HTML including tracking
  pixels and external images.
- **Impact**: **Core Phase 11C value prop is undermined.** SEGs classify by
  content. If canaries carry pixels and external images that real sends strip,
  canaries and real sends may be filtered differently — meaning the
  deliverability percentages on the grid do not reflect production sends'
  actual delivery rate. Auto-pause decisions are based on the wrong signal.
- **Fix**: Apply workspace `contentSanitizerEnabled` policy and
  `sanitizeForSeg()` in `materializeCanarySend()` using the seed inbox's
  gateway before `buildMime`/`adapter.send`, mirroring `handleSendAuto` exactly.

### [CR-03] Canary IMAP arrival: bounce path not implemented + spam mode not mocked + tests missing

- **Location**: `apps/worker/src/handlers/canary-check.ts:121-129`, `apps/worker/src/deliverability/seed-imap.ts:113-116, 151-164`, `apps/worker/src/handlers/canary-check.test.ts:1-19`
- **Dimensions**: Correctness (CORR-002), Testing (TEST-002)
- **Description**: `canary_arrival_status` enum includes `bounced`.
  `deliverability-snapshot.ts` counts `bounced` rows as
  `canary_silent_dropped`. But no production code path sets
  `arrival_status = 'bounced'` — `folderToStatus()` maps
  inbox/spam/quarantine only; `extractCanaryToken()` searches only the
  `X-Quiksend-Canary-Id` header (no `In-Reply-To` / `References` /
  bounce-body fallback); `searchCanaryMessages` mock supports only `inbox`
  and `not_found` — no `spam` mode.
- **Impact**: Hard bounces to seed inboxes get classified as `silent_drop`
  after 24h (or left `pending`), inflating silent-drop counts and potentially
  triggering **false auto-pauses**. Bounce forensics in the deliverability
  grid are wrong. No CI regression protection.
- **Fix**: Extend `extractCanaryToken()` to also match the canary UUID in
  `In-Reply-To`/`References`/bounce body text (typical NDR shape:
  `Content-Type: multipart/report`, `Auto-Submitted: auto-replied`). Add
  `spam` mock mode. Add handler-level tests (see CR-10).

### [CR-04] IMAP canary poll scans every message since 24h — not token-targeted

- **Location**: `apps/worker/src/deliverability/seed-imap.ts:70-88`
- **Dimensions**: Performance (PERF-003)
- **Description**: `searchCanaryMessages` connects to the seed IMAP, iterates
  up to 9 folder candidates, runs `client.search({ since })` for **all UIDs
  in the last 24 hours**, then `fetchOne(uid, { source: true })` — full body
  download — for each UID until every canary token is found.
- **Impact**: A production seed inbox receiving hundreds of messages/day
  forces full-body downloads of unrelated mail on every 5-minute poll. With
  20 seeds and busy inboxes: sustained IMAP bandwidth + CPU. **Poll latency
  grows linearly with inbox volume**, not with pending canary count. Spec
  assumed header-only search.
- **Fix**: Search by custom header (`X-Quiksend-Canary-Id`) or subject suffix
  `[Q{token}]` via IMAP `HEADER`/`TEXT` search criteria; fetch source only
  for matching UIDs. Early-exit once every expected token has been found.

### [CR-05] No cap on concurrent IMAP connections per poll cycle (spec caps at 20)

- **Location**: `apps/worker/src/handlers/canary-check.ts:44-48`, `apps/worker/src/deliverability/seed-imap.ts:59-98`
- **Dimensions**: Performance (PERF-004), Security (SEC-P11-007)
- **Description**: Pending canaries grouped by `seedInboxId`, then
  `Promise.all` launches one `pollSeed` (each opens a fresh IMAP connection,
  no pool) per seed **with no concurrency limit**. Spec § Phase 11C Mechanics
  explicitly caps concurrent IMAP connections at 20 (contrast: DNS uses
  `DNS_CONCURRENCY = 50`).
- **Impact**: 50+ active seeds (provider pool + workspace seeds) means a
  single 5-min cron opens 50+ simultaneous TLS connections. Provider rate
  limits get hit, connection refused errors accumulate, worker memory
  spikes. Combined with CR-04, poll cycle duration can exceed the 5-min
  interval — silent starvation.
- **Fix**: Wrap seed polling in a semaphore (max 20), matching the DNS
  semaphore pattern already at `gateway-detect.ts:83-96`.

### [CR-06] Bulk gateway detection skips DB cache — re-runs DNS for every domain

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:125-129, 105-112`
- **Dimensions**: Performance (PERF-001, PERF-005)
- **Description**: `gateway.detect_bulk` deduplicates domains (`new Set(...)`)
  and respects the 50-wide DNS semaphore, but calls `classifyDomain()`
  **unconditionally** — no `SELECT` against `gateway_classification` to
  filter cached-fresh domains. `gateway.detect_single` has the same bug —
  no cache check on entry.
- **Impact**: Re-importing a 5,000-row CSV with ~500 unique domains
  triggers ~500 full MX→DMARC→SPF cascades even when every domain is
  already cached. Each cascade is up to ~15s worst case (5s MX +
  unbounded TXT). At 50 concurrent lookups, a single import saturates
  worker DNS for minutes and hammers upstream resolvers.
- **Fix**: Before `classifyDomain`, batch-load cached rows: `WHERE
email_domain = ANY($1) AND ttl_until > now()`. Only enqueue DNS for
  cache misses. The pattern used correctly in
  `gateway.apply_classification` (`gateway-detect.ts:170-177`) should be
  applied at the top of `detect_bulk` and `detect_single`.

### [CR-07] `gateway.apply_classification` does 5,000 per-row UPDATEs instead of bulk

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:179-200`
- **Dimensions**: Performance (PERF-002)
- **Description**: After batch-loading cached classifications into a `Map`,
  the handler loops unclassified prospects and runs one
  `UPDATE prospect SET email_gateway = $1 WHERE id = $2` per row (plus
  per-row `gateway.detect_single` enqueue for cache misses).
- **Impact**: 5,000-prospect import batch (capped by `.limit(5000)` at
  line 162) → up to 5,000 DB round trips per job. At ~2–5ms each:
  10–25s of DB time, blocks the pg-boss worker slot, amplifies under
  concurrent imports.
- **Fix**: Replace per-row loop with domain-scoped bulk updates. The
  `applyClassificationToProspects` helper at `gateway-detect.ts:56-80`
  already does this correctly (single UPDATE per domain). Enqueue missing
  domains in one bulk job, not per-prospect `detect_single`.

### [CR-08] Spec-mandated tenancy tests for Phase 11 deliverability data are absent

- **Location**: `apps/web/src/lib/gateway-tenancy.test.ts` (missing), `apps/web/src/lib/deliverability-tenancy.test.ts` (missing)
- **Dimensions**: Testing (TEST-009)
- **Description**: Phase 11 spec § Testing (both Phase 11A and Phase 11C)
  requires org-scoping negative tests following the Wave 5 TEST-015
  `prospect-tenancy.test.ts` pattern. Phase 11 adds three org-scoped tables
  (`seed_inbox`, `canary_send`, `deliverability_snapshot`); zero cross-org
  read tests exist to prove org B cannot see org A's rows.
- **Impact**: Tenancy regressions on Phase 11 tables would not fail CI.
  Wave 5 was clear about this pattern; Phase 11 didn't extend it.
- **Fix**: Add `deliverability-tenancy.test.ts` (and optionally
  `gateway-tenancy.test.ts`) using `withTestOrgs`. Assert cross-org
  `getDeliverabilityGrid`, `listSeedInboxes`, `getCanaryHistory` return
  404 or empty for the other org's data.

### [CR-09] 11C.18/11C.19 provider seed pool crons never implemented

- **Location**: `apps/worker/src/handlers/` (no `seed_pool.*` handlers), `internal-runbooks/seed-pool-setup.md:451-471`, `docs/troubleshooting.md:413`
- **Dimensions**: Completeness (COMP-P11-002, COMP-P11-003, COMP-P11-007)
- **Description**: Tickets 11C.18 (`seed_pool.health_check` — IMAP
  connectivity + dormancy detection, weekly cron) and 11C.19
  (`seed_pool.generate_legit_mail` — weekly cron cycling through legit-usage
  templates) are documented in `internal-runbooks/seed-pool-setup.md` as
  "Track PHI ships". No worker handler exists. No queue registration. No
  cron schedule. The runbook then says "the seed pool health check cron
  should have alerted us already." The troubleshooting doc tells operators
  to look for alerts that never fire.
- **Impact**: Provider-managed seed pool has zero automated health
  monitoring. Seeds go dormant → SEG reputation decay → canary signal
  degrades → users see wrong deliverability numbers → nobody notices.
  Direct operational risk to Deliverability Pro.
- **Fix**: Implement both handlers:
  - `apps/worker/src/handlers/seed-pool-health.ts` — 24h cron; for each
    active `seed_inbox WHERE organization_id IS NULL`, run IMAP `LOGIN`
    - `LIST INBOX`; alert on failure via `event` insert + admin email.
      Also check message count in last 30 days for dormancy.
  - `apps/worker/src/handlers/seed-pool-legit-mail.ts` — weekly cron;
    cycle through templates in `internal-runbooks/seed-pool-legit-usage-patterns.md`;
    cap at 5 messages/seed/week.
    If deferring is acceptable, rewrite the runbook and troubleshooting doc
    to say "manual weekly ops procedure" and remove "Track PHI ships"
    language.

### [CR-10] Canary polling handler has no handler-level tests (only re-tests auto-pause evaluator)

- **Location**: `apps/worker/src/handlers/canary-check.test.ts:1-19`
- **Dimensions**: Testing (TEST-001)
- **Description**: The file exists but its only test imports
  `evaluateAutoPause` from `@quiksend/core/deliverability` and asserts one
  pause decision. That's the SAME test already in
  `packages/core/src/deliverability/auto-pause.test.ts`. The file never
  invokes `runCanaryCheck`, `pollSeed`, `applyCanaryMatches`, or the 24-hour
  silent-drop sweep.
- **Impact**: The Phase 11C P1 invariant "canary polling arrival detection"
  has zero automated regression guard. Broken IMAP poll loop, incorrect
  silent-drop SQL, regression in snapshot coupling — all would ship
  unnoticed. Combined with CR-04, CR-05, CR-11 (load-test not wired), Phase
  11C's core loop has essentially no test coverage.
- **Fix**: Replace the stub. Mock `db` + `searchCanaryMessages`, use
  `QUIKSEND_CANARY_IMAP_MOCK` (extend to `spam` mode per CR-03), seed
  `canary_send`/`seed_inbox` rows via `withTestOrgs`, assert
  `arrival_status` transitions and snapshot side effects. Extend
  `searchCanaryMessages` to accept `spam` mock.

### [CR-11] Canary load-test modes declared but never wired

- **Location**: `scripts/load-test-engine.ts:53-54, 95-100, 918-934`
- **Dimensions**: Performance (PERF-016), Completeness (COMP-P11-008), Testing (TEST-011)
- **Description**: `TestMode` union includes `canary-happy-path` and
  `canary-auto-pause`. `parseArgs` adjusts workspace/enrollment counts when
  `testMode.startsWith("canary-")`. The final `switch` handles only
  `permanent-failure`, `outer-rollback`, `suppression-during-run`, and
  `default` (happy-path). Canary modes fall through to
  `assertHappyPathInvariants()`. `seedCanaryFixture` was removed during PHI
  merge (my session note) and never replaced. Phase 11C exit criteria
  reference these modes.
- **Impact**: Spec exit criteria for 11C are unverifiable via load-test.
  False sense of canary regression coverage. Users following the load-test
  docs would silently get happy-path results.
- **Fix**: Either implement (dedicated `seedCanaryFixture` +
  `runCanaryHappyPath` + `runCanaryAutoPause` per spec § Testing) or remove
  the modes from `TestMode` union and update spec + docs. **Do not** leave
  them declared but non-functional.

## Medium Findings (16)

### [CR-12] Canary step selection ignores injected positions

- **Location**: `apps/web/src/lib/canary-injection.ts:85-114` + `apps/worker/src/deliverability/canary-send.ts:57-58`
- **Dimension**: Correctness (CORR-003)
- **Description**: Injected positions used only for `startAfter` delay (`positions[i] * 5` min). At send time step chosen via `hashToIndex(canaryToken, autoSteps.length)` — independent of injected position. Spec: "same body template as an adjacent real send in the campaign."
- **Fix**: Persist `stepIndex` on `canary_send` at injection time; use it in `materializeCanarySend()` instead of hash.

### [CR-13] `injectionStrategy` config accepted but not implemented

- **Location**: `apps/web/src/lib/canary-injection.ts:121-134` + `packages/core/src/deliverability/canary-config.ts:6-16`
- **Dimension**: Correctness (CORR-004)
- **Description**: Schema supports `random_position` / `first_then_last` / `every_nth`; code always calls `pickRandomPositions`.
- **Fix**: Branch on `config.injectionStrategy` or narrow the union until implemented.

### [CR-14] Canary sends bypass `send_reservation` throttle path

- **Location**: `apps/worker/src/deliverability/canary-send.ts:102-128`
- **Dimension**: Correctness (CORR-005)
- **Description**: Spec: "scheduled via the same `send_reservation` mechanism." Actual: standalone `canary.send` jobs; no `reserveSendSlotInTx`. No SEG sub-cap, per-mailbox daily cap, or 5-min per-domain gap for canaries.
- **Impact**: Canaries measure deliverability under different throttle conditions than real sends; measurement realism diverges.
- **Fix**: Route canaries through `reserveSendSlotInTx` with a synthetic canary reservation type OR document as intentional simplification (with spec update).

### [CR-15] Deliverability snapshot hardcoded 7-day window; grid supports 14/30-day selectors

- **Location**: `apps/worker/src/handlers/deliverability-snapshot.ts:35-49` + `apps/web/src/lib/deliverability.functions.ts:47-54`
- **Dimensions**: Correctness (CORR-006), Performance (PERF-012 partial)
- **Description**: Only 7-day rollup exists. Grid's 14/30-day selectors return the same 7-day snapshot rows. Misrepresents longer trends.
- **Fix**: Parameterize snapshot job for 7/14/30 windows OR compute dynamically in `getDeliverabilityGrid`.

### [CR-16] Sequence live canary indicator server-fn shipped but not wired to UI

- **Location**: `apps/web/src/lib/deliverability.functions.ts:205-259` + `apps/web/src/routes/_protected/sequences/$id/index.tsx`
- **Dimensions**: Architecture (ARCH-004), Completeness (COMP-P11-004)
- **Description**: `getSequenceDeliverability` returns live 2h stats + threshold + `autoPaused`. Never called. Ticket 11C.13 partial: server-fn ships, UI missing.
- **Fix**: Loader-fetch in `sequences/$id/index.tsx`; render green/yellow/red indicator + auto-paused banner.

### [CR-17] In-app auto-pause notifications missing (11C.14 partial)

- **Location**: `apps/worker/src/handlers/canary-check.ts:242-306` + `apps/web/src/routes/_protected/sequences/$id/index.tsx`
- **Dimension**: Completeness (COMP-P11-005)
- **Description**: Email alerts fire; docs promise "toast + persistent banner on sequence page" — not implemented.
- **Fix**: Sequence detail loader checks paused-state + recent `canary.silent_drop_detected` event; render Alert + first-visit toast.

### [CR-18] DNS gateway classification has no domain-allowlist / SSRF-adjacent risk + member-level DNS queries

- **Location**: `packages/mail/src/gateway-detect.ts:133-138` + `apps/web/src/lib/prospects.functions.ts:1100-1136`
- **Dimensions**: Security (SEC-P11-002, SEC-P11-003)
- **Description**: Any workspace member can enqueue DNS lookups on arbitrary domains via `classifyEmail`. Admins can force reclassify. No blocklist for `.local`, `.internal`, `localhost`, metadata-style hostnames. Combined with globally-shared `gateway_classification` cache, an attacker controlling DNS for a domain can poison the cached gateway for that domain **for all workspaces**.
- **Fix**: Domain validation before DNS (reject invalid labels, single-label hosts, reserved names). Rate-limit per-org classification enqueue. Gate `classifyEmail` on `isAdminOrOwner` (or add explicit per-org daily quota).

### [CR-19] User seed IMAP config allows arbitrary host — worker makes outbound connections

- **Location**: `apps/web/src/lib/seed-inbox.functions.ts:51-56` + `apps/worker/src/deliverability/seed-imap.ts:103-110`
- **Dimension**: Security (SEC-P11-001)
- **Description**: `createUserSeedInbox` validates `imapHost` via `z.string().min(1)` only. Worker opens IMAP to arbitrary addresses on 5-min cron. SSRF-style vector for compromised workspace admin (metadata endpoints, internal IPs, port probing).
- **Fix**: Validate `imapHost` against blocklist (RFC1918, link-local, localhost, cloud metadata, bare IPs). Consider provider enum. Add connection timeout + per-org rate limit on verify/poll jobs.

### [CR-20] `docs/deliverability.md` overstates classification triggers

- **Location**: `docs/deliverability.md:29-32`
- **Dimension**: Completeness (COMP-P11-006)
- **Description**: Doc says classification runs for "manual, CSV import, **CRM sync, public API**". Only manual + CSV enqueue detection. CRM upsert path + `POST /api/v1/prospects` skip.
- **Fix**: Enqueue `gateway.detect_single` from CRM upsert + API prospect create paths, OR narrow doc to "manual create + CSV import".

### [CR-21] 6 spec-mandated tests missing (content sanitizer edge cases, gateway single/sweep, per-group auto-pause, snapshot rollup, seed crypto, gateway load-test)

- **Location**: `packages/mail/src/content-sanitizer.test.ts` + `apps/worker/src/handlers/gateway-detect.test.ts` + `canary-check.test.ts` + `packages/mail/src/seed-crypto.ts` + `scripts/load-test-engine.ts`
- **Dimension**: Testing (TEST-005, TEST-006, TEST-008, TEST-010, TEST-012, TEST-014)
- **Description**: Six spec-mandated Phase 11 test cases missing: >100KB image strip, selective pixel keep (tracking vs CDN), `detect_single` cache-miss, `sweep_stale` TTL re-classify, per-`(sequence, mailbox, gateway)` grouping at handler level, snapshot rollup math, seed cred crypto round-trip with both key domains, `gateway-detection` load-test mode.
- **Fix**: Add each test file per spec. See individual TEST-\* entries in `phase11-review/findings/testing.md` for exact expected assertions.

### [CR-22] Phase 11 tables missing from `APP_SCOPED_TABLES_TO_TRUNCATE`

- **Location**: `packages/db/src/testing.ts:25-52`
- **Dimensions**: Security (SEC-P11-005), Testing (TEST-013)
- **Description**: `seed_inbox`, `canary_send`, `deliverability_snapshot` not in truncation list. `withTestOrgs` doesn't clear Phase 11C rows between tests. Not a prod bug but masks tenancy regressions in CI. `tenancy-guard.test.ts` `APP_SCOPED_TABLES` is correct — this is only the truncation list.
- **Fix**: Append the 3 tables (respect FK order: `canary_send` before `seed_inbox`, use CASCADE).

### [CR-23] Missing `canary_send(sent_at)` index + spec's `seed_inbox` indexes

- **Location**: `apps/worker/src/handlers/canary-check.ts:50-59` + `packages/db/src/schema/deliverability.ts:72-76`
- **Dimension**: Performance (PERF-008, PERF-013)
- **Description**: Silent-drop sweep runs every 5 min against unindexed `sent_at`. Spec called for `seed_inbox (organization_id, active)` and partial `(organization_id IS NULL)` — neither exists. Fine at pilot scale; degrades at 10k+ pending canaries or 100+ pool seeds.
- **Fix**: Add partial `(sent_at) WHERE arrival_status = 'pending' AND sent_at IS NOT NULL`. Add spec'd `seed_inbox` composite + partial indexes.

### [CR-24] `maybePauseCampaigns` N+1: per-row sequence + org metadata fetches

- **Location**: `apps/worker/src/handlers/canary-check.ts:156-191`
- **Dimension**: Performance (PERF-009)
- **Description**: Efficient single aggregation SQL, then loops with `db.query.sequence.findFirst` + `loadOrgMetadata` per row. At 1k active sequences with canary coverage → thousands of round trips per 5-min cycle after poll completes.
- **Fix**: Batch-load sequences + org metadata for distinct IDs from aggregation result (2× `inArray` queries), cache in `Map`, evaluate in memory. Optional: lateral join for threshold lookup.

### [CR-25] Pending-canary query unbounded + no DMARC/SPF TXT timeout + no idle seed heartbeat / IMAP pool

- **Location**: `apps/worker/src/handlers/canary-check.ts:31-41` + `packages/mail/src/dns.ts:46-52` + `apps/worker/src/deliverability/seed-imap.ts:61-98`
- **Dimension**: Performance (PERF-006, PERF-007, PERF-010)
- **Description**: 3 spec-listed patterns not shipped: unbounded pending query (no LIMIT), no timeout on `resolveTxtRecords` (MX has 5s), no 30-min idle-seed heartbeat and no IMAP connection pool. All acceptable at pilot scale.
- **Fix**: Add LIMIT + batch processing to pending query. Wrap TXT in same 5s Promise.race. Track `lastPollAt` per seed; poll idle seeds on 30-min cron; introduce per-process IMAP pool keyed by `seedInboxId` (idle TTL 15min, max 20).

### [CR-26] Runbook + troubleshooting docs claim PHI shipped provider-seed crons that don't exist

- **Location**: `internal-runbooks/seed-pool-setup.md:453,470` + `docs/troubleshooting.md:413`
- **Dimension**: Completeness (COMP-P11-007)
- **Description**: Direct downstream of CR-09. Ops runbook says "the seed pool health check cron should have alerted us." Incident-response advice is wrong.
- **Fix**: Bundle with CR-09 fix — either implement crons or rewrite docs.

### [CR-27] Canary effect kinds `send_canary` + `emit_canary_bundle` orphaned in state machine

- **Location**: `packages/core/src/state-machine/types.ts:74-79` + `apps/worker/src/sequence/effects.ts:57-61` + `apps/web/src/lib/effect-executor.ts:206-207`
- **Dimension**: Architecture (ARCH-001)
- **Description**: `Effect` union extended with two canary kinds. Worker has `handleSendCanary`. Both executors have no-op switch arms for `emit_canary_bundle`. **Neither kind is ever produced** by `transition()`. Actual canary path bypasses state machine entirely via `enqueue("canary.send")` from `injectCanariesForEnrollment`. Two parallel canary-send mechanisms coexist; only one is reachable.
- **Impact**: Future contributors will assume canaries flow through state machine (Wave 6 established this pattern). "Transition is single source of truth" invariant is now half-broken.
- **Fix**: Pick one model. **(A)** Remove `send_canary`/`emit_canary_bundle` from `Effect` union + executors, document enrollment-time enqueue as canonical. **(B)** Emit these effects from `transition()`/tick and route canary sends exclusively through `applyTransitionEffects`. Do NOT keep both.

## Low Findings (16)

Consolidated where they share concerns:

- **[CR-28]** SEG gateway allowlist duplicated across 4 locations (ARCH-002) — collapse to one canonical export in `packages/core/deliverability`
- **[CR-29]** Content sanitizer `preferPlainText` drops HTML on any non-empty text (CORR-007) — spec says "complete"; add a length heuristic
- **[CR-30]** `classifyArrivalFolder` defaults unknown folder names to inbox (CORR-008) — optimistic bias; return `not_found` for unrecognized
- **[CR-31]** `listSeedInboxes` exposes provider-managed seed email addresses to Pro workspaces (SEC-P11-006) — hide addresses; show "Proofpoint pool (3 seeds)"
- **[CR-32]** Dead exports: `newCanaryToken` + `sanitizeForSegAsync` + duplicated `extractDomain` (ARCH-003, ARCH-006) — remove or wire; reuse mail export
- **[CR-33]** `gatewayClassification` lacks Drizzle `relations()` (ARCH-005) — minor consistency
- **[CR-34]** `pickLeastLoadedSafeMailbox` runs N reservation COUNTs inside advisory lock (PERF-011) — fine at <5 safe mailboxes
- **[CR-35]** `enterprise_safe` routing filter no dedicated index (PERF-014) — fine at <20 mailboxes/workspace
- **[CR-36]** Test suite wall-clock 56s (was ~30s) (PERF-015) — CI feedback loop degraded
- **[CR-37]** `gateway-detection` load-test mode from spec not implemented (TEST-012, COMP-P11-009) — bundle with CR-11
- **[CR-38]** Entry conditions lack combined `if_no_reply` + gateway predicate test (TEST-007) — composition edge case
- **[CR-39]** "15 new test files" claim overstated (actual: 9 new + 4 extended = 12 touchpoints) (TEST-016) — docs accuracy
- **[CR-40]** `TRACKING_PIXEL_DOMAIN` env var used but undocumented (COMP-P11-012) — add to `.env.example` + `self-host.md`
- **[CR-41]** Deliverability grid lacks global nav link (COMP-P11-013) — discoverability
- **[CR-42]** `docs/deliverability.md` refers to `enrollment.paused` for canary auto-pause; event type mismatch (COMP-P11-014) — downstream of CR-01
- **[CR-43]** Success metrics dashboard + spec feature flags not shipped (COMP-P11-010, COMP-P11-011) — P3 deferrals

## Cross-cutting themes

### Theme 1: Canary system scaffolded but signal not yet trustworthy

CR-02, CR-03, CR-04, CR-05, CR-10 all touch the canary pipeline. Content mismatch
(CR-02) + missing bounce path (CR-03) + IMAP full-body-fetch scale-blocker
(CR-04) + no connection cap (CR-05) + zero handler tests (CR-10) means the
number on the deliverability grid could be wrong, silently, at production
scale, with no CI regression protection. **Fix these five together in the
next sprint** — they're the entire "signal reliability" story for
Deliverability Pro.

### Theme 2: Provider seed pool automation missing

CR-09 (crons don't exist) + CR-26 (runbook lies about them) is one problem
with two surfaces. Either implement `seed_pool.health_check` +
`seed_pool.generate_legit_mail` or gut the runbook language. Cannot ship
Deliverability Pro to paying customers with this gap.

### Theme 3: Webhook events registered, never fired

CR-01. Fanout wire is missing. Four documented event types produce nothing.
Marketing doc + settings UI advertise capabilities that don't exist. Simple
fix (5 `insertDomainEventAndFanout` calls), high urgency because docs are
already public.

### Theme 4: Test coverage gaps concentrated on 11C handlers

CR-08 (no tenancy tests) + CR-10 (no handler tests) + CR-11 (load test not
wired) + CR-21 (6 spec-mandated tests missing) — 4 of 11 High findings are
testing gaps. Phase 11 shipped test files that don't test what they claim
to test. Sprint work here must include filling these coverage gaps
alongside the feature fixes, otherwise the fixes have no regression
protection.

### Theme 5: Perf hot paths not-yet-optimized

CR-04, CR-05, CR-06, CR-07, CR-23, CR-24, CR-25 are all Phase 11
performance concerns. None are broken at pilot scale (10s of canaries,
100s of prospects, single-workspace usage). At Phase 11 target scale (1k+
canaries, 100+ pool seeds, 5,000-prospect imports) they compound quickly.
Fix in order: CR-06 (bulk detect skips cache) first, then CR-07 (per-row
UPDATE), then CR-04 + CR-05 (IMAP), then rest.

### Theme 6: What DIDN'T regress

Wave 5-6 invariants held cleanly. `packages/mail` still decoupled from
`packages/integrations`. `packages/core/deliverability/*` genuinely pure.
`orgFn` chokepoint on all new server-fns. Effect executor extensions clean.
State machine event union extended once (`no_safe_mailbox`), consistently
used. No Phase 11D LinkedIn adapter leaked. No cross-tenant data leakage
in shipped code. Encryption domain split for provider vs user seeds is
correctly implemented. This is a **clean architectural extension**, and
the failures above are all in the layer above the architecture (feature
wiring, canary signal quality, test coverage).

---

## Recommendation

**Cut a Wave 8 focused on the 11 High findings before promoting Deliverability
Pro to paying customers.** Split into two sprints:

### Sprint 1 (v2.3.0) — signal reliability + fanout

The five findings that make the deliverability signal trustworthy plus the
webhook fanout that makes it externally-consumable:

| CR    | Title                           | Est.    |
| ----- | ------------------------------- | ------- |
| CR-02 | Canary sanitizer parity         | 0.5 day |
| CR-03 | Bounce path + spam mock + tests | 1 day   |
| CR-04 | Header-only IMAP search         | 0.5 day |
| CR-05 | IMAP semaphore                  | 0.5 day |
| CR-10 | Real canary handler tests       | 1 day   |
| CR-01 | Webhook fanout wiring           | 1 day   |
| CR-08 | Deliverability tenancy tests    | 0.5 day |

**~5 days, one agent.** After Sprint 1, the deliverability grid numbers are
trustworthy and external systems can subscribe to real signals.

### Sprint 2 (v2.4.0) — Pro tier operational readiness

The rest of the High findings + top Medium findings before real Deliverability
Pro subscribers can be onboarded:

| CR    | Title                                                             | Est.    |
| ----- | ----------------------------------------------------------------- | ------- |
| CR-09 | Implement seed pool health check + legit-usage crons              | 2 days  |
| CR-26 | Reconcile runbook + troubleshooting with reality (fixup of CR-09) | 0.5 day |
| CR-06 | Bulk detect cache-lookup                                          | 0.5 day |
| CR-07 | Bulk UPDATE in apply-classification                               | 0.5 day |
| CR-11 | Wire canary load-test modes (with fixture + assertions)           | 1 day   |
| CR-14 | Route canaries through send_reservation                           | 1 day   |
| CR-15 | Snapshot windowing                                                | 0.5 day |
| CR-16 | Wire sequence live indicator                                      | 0.5 day |
| CR-17 | In-app auto-pause banner                                          | 0.5 day |
| CR-18 | Domain allowlist + rate-limit for classifyEmail                   | 0.5 day |
| CR-19 | IMAP host blocklist                                               | 0.5 day |
| CR-24 | maybePauseCampaigns batch-load                                    | 0.5 day |

**~8 days.** After Sprint 2, Deliverability Pro is operationally honest —
provider pool self-heals, signal is trustworthy, external ops can subscribe.

### Later

Medium findings not in Sprint 2 + all Low findings can wait for a Wave 9
"Phase 11 polish" or backlog. None are blockers for GA.

### Do not ship without at least Sprint 1

The webhook events documented in `docs/webhooks.md` and shown in the settings
UI dropdown are a **public commitment** that we made and don't yet honor.
That's a credibility issue even for free-tier users; also the deliverability
grid numbers that Pro subscribers will pay for aren't reliable until
CR-02/03/04/05 land. Sprint 1 is the minimum bar.

---

## Deduplication rules applied (multi-reviewer-patterns SKILL)

- **11 raw findings merged into 4 consolidated entries**:
  - CR-01: COMP-P11-001 (high) + TEST-015 (medium) + SEC-P11-004 (low) — same root cause, took highest severity per rule 4
  - CR-05: PERF-004 (high) + SEC-P11-007 (low) — same file+line, different concerns but same fix
  - CR-06: PERF-001 (high) + PERF-005 (medium) — same root cause in two handlers
  - CR-15: CORR-006 (medium) + PERF-012 (partial) — snapshot windowing correctness + perf both blocked on same underlying fix
  - CR-16: ARCH-004 (low) + COMP-P11-004 (medium) — same missing UI wire
  - CR-18: SEC-P11-002 (medium) + SEC-P11-003 (medium) — same DNS-classification attack surface, different entry points
  - CR-22: SEC-P11-005 (low) + TEST-013 (medium) — same file, took higher severity
  - CR-32: ARCH-003 (low) + ARCH-006 (low) — same theme (dead + duplicated exports)
  - CR-37: TEST-012 (medium) + COMP-P11-009 (low) — same missing load-test mode
  - CR-43: COMP-P11-010 (low) + COMP-P11-011 (low) — spec P3 deferrals bundled
  - CR-11: PERF-016 (low) + COMP-P11-008 (medium) + TEST-011 (high) — same load-test wiring, took highest severity
- **Severity calibration**:
  - Missing tests for critical paths (canary polling, tenancy) elevated to at least Medium per SKILL rule
  - Security findings exploitable by workspace admins (CR-18, CR-19) kept at Medium (not exploitable by external users)
  - Perf findings in hot paths at least Medium
  - Documentation-only accuracy issues kept at Low

## Per-dimension positive observations

Retained from individual reports:

- **Security**: Encryption domain split correctly implemented (`resolveSeedEncryptionKey`). Provider IMAP creds never reach workspace API. Pro entitlement server-side only. Tenancy CI guard covers all Phase 11C tables. Nango webhook replay protection improved since Wave 5.
- **Correctness**: Routing decision table full spec coverage including anchor exception. Gateway cascade full: MX → DMARC → SPF → low-conf MX → unknown. Auto-pause evaluator pure with divide-by-zero safety. State machine `no_safe_mailbox` clean single addition.
- **Architecture**: CR-009 (mail/integrations decoupling from Wave 5) preserved. `packages/core` purity intact. Tenancy chokepoint via `orgFn` on all new server-fns. Foundation → TAU handoff clean (no `NotImplementedError` remains).
- **Performance**: DNS semaphore + MX timeout correct. Bulk import dedupes by domain. Cache-before-enqueue in apply path. Canary poll groups by seed inbox (one session per seed). Grid reads pre-aggregated snapshots (no live JOIN). Wave 5 reservation index regression fixed.
- **Testing**: `gateway-detect.test.ts` thorough (fingerprints + split-brain + failure modes). Auto-pause + mailbox-safety pure-function tests clean. `seg-routing.integration.test.ts` real E2E coverage. Wave 5 `withTestOrgs` pattern consistently used.
- **Completeness**: 11A 11/11 ✅, 11B 10/10 ✅, 11C code 12/14 (13-14 partial), 11C-ops 3/5. Migration split (Foundation → TAU → UPSILON → PHI) matches wave ownership. User-facing guide mostly accurate. No Phase 11D leakage.
