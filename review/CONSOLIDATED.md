# Full V0 Consolidated Review Report

**Target**: Quiksend V0 (v2.0.0) — all commits `18d0abb..898c7f7` (283 files, ~68k LOC)
**Reviewers**: Security, Correctness, Architecture, Performance, Testing, Completeness
**Date**: 2026-07-01
**Files Reviewed**: ~120 (spans 10 packages + 2 apps)

## Overall verdict: **needs-fixes**

V0 ships a large amount of substantial, working code, and the highest-risk architectural patterns hold up under review: `packages/core` is genuinely pure, `SELECT ... FOR UPDATE SKIP LOCKED` is used correctly, migration chain is healthy, and the AES-256-GCM SMTP encryption, unsubscribe HMAC token, and Better Auth cookie hardening all check out.

But **six issues in the load-bearing engine + compliance path would surface on the first real customer** and must ship before V0 is production-honest.

## Aggregate counts (post-dedup)

| Dimension | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Security | 1 | 2 | 6 | 4 | 13 |
| Correctness | 2 | 3 | 1 | 0 | 6 |
| Architecture | 0 | 5 | 6 | 5 | 16 |
| Performance | 1 | 6 | 9 | 4 | 20 |
| Testing | 0 | 8 | 9 | 4 | 21 |
| Completeness | 0 | 4 | 7 | 4 | 15 |
| **Total (raw)** | **4** | **28** | **38** | **21** | **91** |
| **Total (post-dedup)** | **3** | **26** | **35** | **21** | **85** |

Dedup merged 6 findings that were reported by multiple reviewers (see § Cross-cutting below).

---

## 🚨 P0 — MUST-FIX BEFORE ANY REAL CUSTOMER

### [CR-001] Suppression table ignored on every send path — CAN-SPAM + legal exposure

**Location**: `apps/worker/src/sequence/guards.ts:7-9`, `apps/web/src/lib/compose.functions.ts:111-175`, `apps/web/src/lib/inbox.functions.ts:305-306`
**Severity**: **CRITICAL** (Security SEC-001 CRITICAL + Correctness BUG-003 HIGH + Completeness COMP-003 HIGH)
**Reported by**: 3 reviewers
**What**: `isSuppressed(ctx)` only checks `prospect.status`. The `suppression` table — populated by manual admin blocks, hard bounces, unsubscribes, and complaints — is **never queried before an outbound send**. Manual `suppressEmail` writes `suppression` but doesn't update `prospect.status`. Hard bounces insert `suppression` but don't set prospect status (`inbound-handler.ts:71-82`).
**Impact**: Emails send to addresses on the suppression list. Re-enrolling a bounced/unsubscribed address into a new sequence resumes sends. CAN-SPAM violation on every send after unsubscribe. Deliverability + legal + reputational damage.
**Fix**: Every send path (`execute-step.ts`, `sendComposedMessage`, `sendReply`) queries `suppression WHERE (organization_id, value) = (?, ?)` before touching adapter. Align `suppressEmail`, bounce handler, and unsubscribe token handler to ALSO update `prospect.status`. Add DB constraint or trigger to keep them coherent. Reject enrollments for suppressed emails at enroll time.

### [CR-002] Engine dead-letter path is unreachable — stuck-forever enrollments

**Location**: `apps/worker/src/sequence/execute-step.ts:68-76` + `apps/worker/src/sequence/tick.ts:24`
**Severity**: **CRITICAL** (Correctness BUG-001)
**Reported by**: 1 reviewer (correctness), confidence high
**What**: `execute-step.ts` computes `isDead = (attempt + 1 >= maxAttempts)` using `payload.attempt`. The tick enqueues with `attempt: 0` and never updates it — pg-boss handles retries internally but doesn't rewrite the payload. So `isDead` is always `(0 + 1 >= 5) = false`. `handleStepFailure` never fires. When pg-boss exhausts its 4 retries, it drops the job silently. The enrollment stays `active` with no error visibility.
**Impact**: Any permanent send failure (invalid recipient, revoked OAuth, hard SMTP error) → job silently dies → enrollment stuck `active` forever → no alert. Combined with CR-003 below, the enrollment is also invisible to the scheduler. This is the "silent stall" failure mode the Phase 6 brief explicitly said must not happen.
**Fix**: Read attempt count from `enrollment.attempt_count` or the pg-boss job metadata (job.retryCount). Increment `enrollment.attempt_count` in `handleStepFailure`. Emit a `step_failed` event → state machine transitions to `failed` at max attempts → dead-letter row + Sentry alert.

### [CR-003] Tick clears `next_run_at` before step succeeds — enrollments invisible on failure

**Location**: `apps/worker/src/sequence/tick.ts:18-25`
**Severity**: **CRITICAL** (Correctness BUG-002)
**Reported by**: 1 reviewer, confidence high
**What**: Tick nulls `next_run_at` in the SAME transaction as the claim (safe against re-ticks), then enqueues `sequence.step`. But if enqueue fails, or the step job permanently fails without dead-lettering (see CR-002), the enrollment has `next_run_at = NULL` and won't be picked up again.
**Impact**: Compounds CR-002. Even if enqueue works, any permanent step failure + missed dead-letter = permanent stall with `state='active' next_run_at=NULL`.
**Fix**: Either (a) leave `next_run_at` set and use a per-enrollment claim table with a TTL, or (b) reset `next_run_at` in dead-letter path (which requires CR-002 fixed), or (c) enqueue with a "reschedule on failure" callback that re-sets `next_run_at`. Combined with CR-002 fix, the state machine's `step_failed` handler should reschedule with backoff on transient errors.

---

## 🔴 P1 — HIGH-SEVERITY, ship in the same sprint as P0

### [CR-004] CAN-SPAM footer in auto-emails uses placeholder unsubscribe URL + postal address

**Location**: `apps/worker/src/sequence/effects.ts:287-291`
**Severity**: **HIGH** (Correctness BUG-004 + Completeness COMP-002 co-located issue)
**Reported by**: 2 reviewers
**What**: Automated follow-up sends via `handleSendAuto` use hardcoded `https://app.example.com/u/pending` for the unsubscribe URL and a placeholder postal address. Manual compose (`compose.functions.ts`) correctly mints a real unsubscribe token via `mintUnsubscribeToken`. Every automated send is CAN-SPAM non-compliant.
**Impact**: Every scheduled follow-up sent via the engine — the entire product's raison d'être — sends non-compliant email. Recipients clicking the placeholder link get a broken page. CAN-SPAM requires functional opt-out on every commercial email.
**Fix**: `effects.ts:287-291` mint `mintUnsubscribeToken({ prospectId, orgId })` and pull real postal address from workspace settings (`organization.metadata.postal_address` per Phase 4 brief). Same as manual compose. Regression test: assert MIME output includes a valid token URL that verifies against `UNSUBSCRIBE_TOKEN_SECRET`.

### [CR-005] Send reservation + SMTP + `markReservationSent` not atomic — cap leak + double-send risk

**Location**: `apps/worker/src/sequence/reserve-slot.ts:86-133` + `apps/worker/src/sequence/effects.ts:234-360`
**Severity**: **HIGH** (Correctness BUG-005)
**Reported by**: 1 reviewer, confidence high
**What**: `reserveSendSlot` opens its OWN transaction (commits a `held` reservation), returns. `adapter.send()` runs. `markReservationSent` uses global `db` handle, NOT the executor's outer transaction. If outer TX rolls back AFTER SMTP succeeded but BEFORE `markReservationSent`, the message row is undone but the reservation is `held` (autocommitted). Daily-cap counter stays inflated; on retry, the idempotency check finds no `message` row → sends again → double-send.
**Impact**: Race window is small but real. On DB flakes or connection drops mid-send, results in either double-send (worst) or cap-count drift (still bad — mailbox may over/under-send).
**Fix**: Two options. (a) Run the ENTIRE send flow (reservation + adapter call + message insert + markReservationSent) in one outer transaction with the reservation as a savepoint. (b) Write the `message` row FIRST with `status='sending'`, then adapter.send, then update to `status='sent'` — retry check reads `sending`/`sent` as "already tried" and consults provider for actual state. Add a load-test scenario that rolls back after adapter.send returns.

### [CR-006] OAuth mailboxes broken on manual compose + inbox reply — V0 DoD #1 blocked

**Location**: `apps/web/src/lib/compose.functions.ts:123`, `apps/web/src/lib/inbox.functions.ts:305-306`, `apps/web/src/lib/mailboxes.functions.ts:316-348`
**Severity**: **HIGH** (Completeness COMP-001 + COMP-002 + COMP-008)
**Reported by**: 1 reviewer (completeness), confirmed by architecture ARCH-004 (mail depends on integrations makes this fixable)
**What**: `sendComposedMessage`, `sendReply`, and `testMailboxSend` all hard-fail with `throw new Error("Only SMTP mailboxes are supported in Wave 1")` on Gmail/Microsoft. Meanwhile the worker's auto-send path uses `createAdapterForMailbox` and handles all three providers correctly.
**Impact**: **V0 DoD #1 — "manual-first → auto follow-up" — is not demoable on Gmail or Microsoft 365 mailboxes.** The one flagship product flow works only for BYO-SMTP. This is a "V1 that's really v0.9" situation — the compose UI accepts an OAuth mailbox but the send fails.
**Fix**: Replace the guard with a call to `createAdapterForMailbox` and drop the "Wave 1" comment. Regression test: mock Gmail adapter, assert compose sends successfully.

### [CR-007] Auth IP rate limit implemented but never wired

**Location**: `apps/web/src/routes/api/auth/$.ts:4-9` (Nango webhook + auth handler) + `apps/web/src/lib/api/v1/middleware.ts:175-188` (the limiter that never gets called)
**Severity**: **HIGH** (Security SEC-002)
**Reported by**: 1 reviewer
**What**: `checkAuthIpRateLimit` is a fully-implemented per-IP token bucket. But `apps/web/src/routes/api/auth/$.ts` delegates directly to `auth.handler(request)` without calling the limiter.
**Impact**: Unlimited credential stuffing / password guessing / OAuth callback abuse per IP. Better Auth may have internal limits but they're undocumented and not what the phase brief specified.
**Fix**: Wrap `GET`/`POST` handlers: check `checkAuthIpRateLimit(request)` → return 429 with `Retry-After` on breach → else delegate to `auth.handler`. Consider a shared Redis backend for multi-instance deploys.

### [CR-008] Production-critical secrets marked `.optional()` — silent misconfigured deploys

**Location**: `packages/config/src/env.schema.ts:18-19, 29-30, 43-48`
**Severity**: **HIGH** (Security SEC-003)
**Reported by**: 1 reviewer
**What**: `BETTER_AUTH_SECRET`, `NANGO_WEBHOOK_SECRET`, `MAILBOX_ENCRYPTION_KEY`, `UNSUBSCRIBE_TOKEN_SECRET` are all `.optional()`. Production can boot without them. Nango webhooks silently reject everything (SEC-004), unsubscribe silently fails, mailbox creation silently fails.
**Impact**: A production deploy missing one of these boots successfully, `pnpm check` passes, but half the app is silently broken. Users click unsubscribe links that never work.
**Fix**: `packages/config/src/env.schema.ts` add a `.refine()` block gated on `NODE_ENV === "production"` that requires these secrets. Also require min-length on `BETTER_AUTH_SECRET` (32 bytes recommended). Regression: a CI job that boots with missing prod secrets → exits with clear "SECRET_MISSING_IN_PRODUCTION" error.

### [CR-009] `packages/mail` depends on `packages/integrations` — architectural inversion

**Location**: `packages/mail/package.json:22-24`, `packages/mail/src/adapters/index.ts:2-7`
**Severity**: **HIGH** (Architecture ARCH-004)
**Reported by**: 1 reviewer
**What**: `createAdapterForMailbox` in `packages/mail` imports `getNango` from `@quiksend/integrations`. Phase brief + `CLAUDE.md` state mail depends only on config. This inversion means `packages/mail` can't be tested or reused without pulling in the CRM integration stack.
**Impact**: Slows future work. Anything wanting to use mail (e.g. a new inbound provider or a marketing bulk-send package) drags in Nango + CRM providers. Violates the layering claim.
**Fix**: Inject `NangoProxyClient` as a factory parameter to `createGmailAdapter`/`createMicrosoftAdapter`. The worker's `createMailboxAdapter` in `apps/worker/src/sequence/mailbox-adapter.ts` becomes the wiring point that fetches the Nango client and passes it in. `packages/mail` stays config-only.

### [CR-010] State machine `effects[]` dropped by 3 non-executor paths

**Location**: `apps/worker/src/sequence/execute-step.ts:27-56` (ARCH-001), `apps/web/src/lib/compose.functions.ts:338-399` (ARCH-002), `apps/web/src/lib/sequences.functions.ts:836-865` (ARCH-003)
**Severity**: **HIGH** (Architecture ARCH-001 + ARCH-002 + ARCH-003)
**Reported by**: 1 reviewer, all three from same file
**What**: Three places call `transition()` from `@quiksend/core` but don't run the returned `effects[]`:
- Worker `execute-step.ts` synthesizes `terminate` effects directly for suppression/reply pre-checks, bypassing `transition({ kind: "reply_received" })`.
- Web compose interprets `manual_sent` effects manually — only handles `capture_anchor` + `advance_step`. Drops any new effect kind added later.
- Web `pauseEnrollment` / `resumeEnrollment` / `stopEnrollment` persist `nextState` but drop `effects[]` — `emit_event` never fires, analytics + webhooks miss pause/resume/stop signals.
**Impact**: Product events (`enrollment.paused`, `enrollment.resumed`, `enrollment.stopped`) never emit → webhook subscribers miss them → analytics blind. Future effects added to the state machine will be silently dropped in these three paths.
**Fix**: Extract the executor's effect switch into a shared helper. Compose + sequences functions + worker suppression/reply pre-checks all route through it. Or emit proper events (`reply_received` from worker instead of synthesizing terminate; `pause`/`resume`/`stop` from web that funnel to worker via a job).

### [CR-011] AI provider abstraction bypassed for model metadata

**Location**: `packages/ai/src/generation/generate-email.ts:13-16`
**Severity**: **HIGH** (Architecture ARCH-005)
**Reported by**: 1 reviewer
**What**: `modelId()` reads `process.env.AI_DEFAULT_PROVIDER` directly and hardcodes `"claude-sonnet-4-5"` / `"gpt-4o"`. Actual inference uses `getDefaultModel()` from the provider abstraction. Stored `generation.model` in DB can disagree with the model actually used.
**Impact**: Audit trail lies. Debugging "why did this generation look wrong?" is broken because the recorded model isn't what ran.
**Fix**: Have `getDefaultModel()` return `{ model, modelId }` tuple. Persist `modelId` from the tuple.

### [CR-012] Microsoft Graph delta poll drops messages beyond first page

**Location**: `apps/worker/src/handlers/mailbox-poll.ts:398-460`
**Severity**: **HIGH** (Performance PERF-023 flagged, also correctness)
**Reported by**: 1 reviewer
**What**: `pollMicrosoft` reads `data.value` once and never follows `@odata.nextLink`. Microsoft Graph delta responses paginate at 100 records.
**Impact**: Busy inboxes lose replies/bounces silently. Enrollments miss reply events, keep sending. Compounds any customer with high inbound volume.
**Fix**: Loop on `@odata.nextLink` until exhausted or a page cap. Add a regression test with a mocked multi-page delta response.

### [CR-013] Keyset cursor uses `created_at` regardless of `sortField` — wrong pages returned

**Location**: `apps/web/src/lib/prospects.functions.ts:251-282`
**Severity**: **HIGH** (Performance PERF-014, correctness impact)
**Reported by**: 1 reviewer
**What**: `orderBy` uses `sortColumn(data.sortField)` but the cursor predicate always compares `created_at` and `id`.
**Impact**: When user sorts prospects by email/name/status, pagination returns wrong rows on page 2+. Users see duplicates or miss records.
**Fix**: Include the sort key in the cursor payload. Add composite indexes per sort mode.

### [CR-014] 5000-row CSV import runs synchronously in HTTP handler

**Location**: `apps/web/src/lib/prospects.functions.ts:191, 709-810` + `apps/web/src/lib/prospect-import.ts:208-244`
**Severity**: **HIGH** (Performance PERF-024 — flagged CRITICAL, but downgraded since Phase 2 brief allowed 5000-row inline as an acceptable interim)
**Reported by**: 1 reviewer
**What**: 5000 rows × 3-5 queries each = ~20k DB round-trips in one HTTP request. Handler ties up a connection pool slot for 30s–several minutes.
**Impact**: Gateway timeouts on real imports. Connection pool exhaustion. Bad UX. Phase 6 brief said to defer to `crm.import` async job, which was never wired.
**Fix**: Enqueue `import.process` job on pg-boss. Batch upsert 100-500 rows per query using `INSERT ... ON CONFLICT`. Return `batch_id` immediately, poll for progress.

---

## 🟡 Notable HIGH-severity (P1) findings

Grouped by dimension for scannability. Full details in each dimension's file.

### Security (SEC)
- **SEC-002 HIGH** — Auth IP rate limit not wired (merged into CR-007 above)
- **SEC-003 HIGH** — Prod secrets optional (merged into CR-008 above)
- **SEC-004 MED** — Nango inbound webhook: no replay protection (no timestamp/nonce dedup). Store processed webhook IDs.
- **SEC-005 MED** — Outbound webhook signs `(timestamp + payload)` but not `deliveryId`. Include `deliveryId` in HMAC input.
- **SEC-006 MED** — Auth rate limit uses in-process `Map`. Won't survive restart or horizontal scale.
- **SEC-008 MED** — Prompt injection: scraped web content inlined into prompts without structural delimiters. Wrap in `<untrusted-source>` tags in the system prompt.

### Correctness (BUG)
- **BUG-006 MED** — Compose `mailboxId` not validated to match `enrollment.mailboxId` when anchoring. Same-mailbox threading invariant relies on caller passing the right id.

### Architecture (ARCH)
- Most HIGH findings covered by CR-009 and CR-010 above.
- **ARCH-007 MED + Testing gap** (co-located): `APP_SCOPED_TABLES` in tenancy guard missing `jobLog`, `sendReservation`, `listMember`, `importError`. Testing also flagged `apikey` missing from `APP_SCOPED_TABLES_TO_TRUNCATE`. Cross-test leakage risk. Fix: extend guard with FK-chain rules, add `apikey` to truncate list.
- **ARCH-010 MED** — `_protected` layout guard is weaker than `orgFn` (session check only, no active workspace check). UI can load, data calls fail. Align.
- **ARCH-011 MED** — Zod schemas duplicated between `*.functions.ts` and `/api/v1/*`. Extract shared schemas.

### Performance (PERF)
- **PERF-005 HIGH** — Cap COUNT filters `reserved_at` but index is on `window_start`. Query filter/index mismatch on every reservation → hot path degrades under load. Fix index.
- **PERF-007 HIGH + PERF-026 HIGH** (same root) — `message.enrollment_id` has no index but analytics + inbox filters use it via `EXISTS` and JOINs. Add `message(enrollment_id)` index.
- **PERF-011 MED** — `enrollment(organization_id, sequence_id)` missing for analytics + inbox subqueries.
- **PERF-015 MED** — Default prospect list sort lacks index for `(organization_id, created_at DESC, id) WHERE deleted_at IS NULL`.
- **PERF-016 MED** — ILIKE search has no trigram indexes; leading wildcard prevents btree use. Unusable past ~50k rows/org.
- **PERF-017 MED** — CRM writeback has no queue-level retry backoff; on 429 after Nango's 3 internal retries, job dies permanently.
- **PERF-019 MED** — Webhook sweep 50/min + no concurrency cap → 500-event burst takes minutes to drain.
- **PERF-022 MED** — Mailbox poll enqueues all mailboxes at cron edge → burst.

### Testing (TEST)
- **HIGH x 8** — Missing regression tests for (in order of blast radius):
  1. Idempotency skip path (`effects.ts:248-268` retry-with-same-key branch)
  2. `captureManualAnchor` DB round-trip (state machine test asserts effect emission but nothing tests the persistence)
  3. CRM writeback replay dedupe (`crm-writeback.ts:224-231`)
  4. Quiksend HMAC webhook sign/verify (only Nango inbound tested, not outbound)
  5. API key org scoping (no HTTP-level test)
  6. Tenancy for 9 entities beyond prospects (sequences, mailboxes, CRM, messages, enrollments, value_prop, research_profile, webhooks, api keys)
  7. `apikey` not in truncation list (leakage risk once API-key tests added)
  8. Load tests never run in CI — invariants only verified on manual `tsx` runs

### Completeness (COMP)
- **COMP-004 HIGH** — Prospect detail (PRD C3) shows static placeholders for sequence/message timeline. Load real enrollments + messages, link to research profile.
- **COMP-005 MED** — Step `entry_condition` (e.g. `if_no_reply`) exists in schema + UI but worker never enforces it.
- **COMP-006 MED** — PRD G4 sentiment/triage tags on inbound not implemented.
- **COMP-007 MED** — PRD C2 "pull prospects/accounts from CRM into a list" — workspace-wide sync exists but no list-scoped pull UI.

---

## Cross-cutting patterns (post-dedup summary)

| Root issue | Reviewers reporting | P0 finding |
|---|---|---|
| Suppression table not enforced pre-send | Security (CRITICAL) + Correctness (HIGH) + Completeness (HIGH) | **CR-001** |
| Engine dead-letter path broken | Correctness (CRITICAL) | **CR-002** |
| `next_run_at` cleared before step succeeds | Correctness (CRITICAL) | **CR-003** |
| CAN-SPAM placeholder in auto-send | Correctness (HIGH) + Completeness (HIGH) | **CR-004** |
| OAuth mailboxes rejected on compose/reply | Completeness (HIGH x3) | **CR-006** |
| Tenancy guard `APP_SCOPED_TABLES` incomplete | Architecture (MED) + Testing (HIGH) | see § Architecture below |
| Missing tests across the board | Testing (HIGH x8) | see § Testing above |

---

## Recommendation & prioritized action plan

**V0 has landed a substantial functional surface, but is not production-honest.** Six defects touch the load-bearing engine + compliance layer and would surface in the first 100 customers. Fixing them is small work — most are 20–100 LOC changes — but they touch behaviors the load test didn't exercise.

### Sprint 1 (must ship as v2.0.1 or v2.1.0)

**All P0 + CR-004 + CR-006 + CR-007 + CR-008. Estimated ~2-3 days.**

1. **CR-001** — Add `suppression` check to `guards.ts`; wire `suppressEmail`/bounce/unsubscribe to also update `prospect.status`. Add tests: manual suppression blocks send, hard-bounced address stays blocked on re-enroll.
2. **CR-002 + CR-003** — Fix dead-letter reachability. Add `enrollment.attempt_count` increment in `handleStepFailure`. Reset `next_run_at` on transient retry, terminate on permanent. Add test: 5 failed retries → enrollment `state='failed'` + `job_log` `dead` row.
3. **CR-004** — Replace placeholder unsubscribe URL + postal address with real values in `effects.ts` auto-send path. Same code as manual compose. Test: MIME output contains a valid signed unsubscribe token.
4. **CR-005** — Restructure send flow so reservation + adapter.send + message insert + markReservationSent are one logical unit (single outer TX with savepoint OR write `message` FIRST with `status='sending'`).
5. **CR-006** — Replace `throw "Only SMTP supported"` in compose/inbox/testSend with `createAdapterForMailbox`. Test with mocked Gmail adapter.
6. **CR-007** — Wire `checkAuthIpRateLimit` on `/api/auth/*`.
7. **CR-008** — Add `.refine()` guard on env schema requiring prod secrets. CI test.

### Sprint 2 (v2.2.0)

**Remaining HIGH + architectural cleanup. ~4-5 days.**

- **CR-009** — Decouple mail from integrations. Inject `NangoProxyClient`.
- **CR-010** — Extract shared effect executor. Route compose + sequence pause/resume through it.
- **CR-011** — Return `modelId` alongside `model` from provider abstraction.
- **CR-012** — Paginate Microsoft Graph delta responses.
- **CR-013** — Fix prospect keyset cursor to include sort key.
- **CR-014** — Move CSV import to pg-boss `import.process` job.

### Sprint 3 (v2.3.0)

**Performance indexes, test coverage, tenancy hardening. ~1 week.**

- Add all missing indexes flagged by Performance review (message.enrollment_id, cap `reserved_at` alignment, prospect sort, enrollment(org, sequence_id), enrollment(org, state)).
- Add tenancy tests for 9 missing entities. Add integration test for the full manual-first flow (Mailpit-based).
- Extend tenancy guard `APP_SCOPED_TABLES` with `jobLog`/`sendReservation`/`listMember`/`importError`. Add `apikey` to truncation list.
- Wire `entry_condition` enforcement in worker (COMP-005).
- Materialize analytics rollup tables when funnel query > 500ms.

### Fast-follows (planned per PRD)

- LinkedIn channel, warm-up pool, AI SDR autopilot — explicitly deferred, not bugs.
- OAuth compose (CR-006) IS a bug — should have shipped in Wave 2 alongside the adapters.

---

## Positive observations (what worked)

1. **`packages/core` is genuinely pure.** State machine + schedule math have zero I/O imports. Foundation of the engine holds.
2. **`SELECT ... FOR UPDATE SKIP LOCKED` + `pg_advisory_xact_lock(mailboxId)` are used correctly.** The two hardest concurrency primitives in the plan are implemented right.
3. **AES-256-GCM SMTP encryption is textbook**: random 12-byte nonce, auth tag, 32-byte key validation, tamper-rejection test.
4. **Better Auth defaults preserved.** `httpOnly`, `SameSite=Lax`, CSRF enabled. Not disabled anywhere.
5. **Unsubscribe HMAC token is correct.** `timingSafeEqual`, `UNSUBSCRIBE_TOKEN_SECRET`, base64url.
6. **API tenancy pattern is uniform.** All server-fns compose `orgFn`. API returns 404 (not 500 or empty 200) on cross-org id access.
7. **Migration chain is healthy.** 12 SQL files, monotonic `prevId` chain, journal in sync (the phase-3 rebase artifact stayed fixed).
8. **Nango webhook uses `timingSafeEqual`** for HMAC comparison. No timing oracle.
9. **All 15 bounce corpus samples classified correctly.** Including the 3 non-bounce false-positive checks.
10. **Effect executor handles all 9 effect kinds.** No silent no-op inside the worker's happy path.

---

## Consolidated finding count by severity (final)

| Severity | Count | Merged from |
|---|---|---|
| Critical | 3 | Security 1, Correctness 2 (CR-001 merged 3 reviewers) |
| High | 26 | across all 6 dimensions after dedup |
| Medium | 35 | after dedup |
| Low | 21 | style/informational |
| **Total** | **85** | |

**Final verdict**: **needs-fixes**. V0 v2.0.0 is a real milestone with substantial working code, but it is not production-honest until the six P0/P1 items above land. Estimated 3 sprints (~2 weeks) to get to a customer-ready v2.1.0.
