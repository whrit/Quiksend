# Testing Review Findings

## Summary

- Files reviewed: 24 unit/integration test files, 2 load-test scripts, `packages/db/src/testing.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`
- Critical: 0, High: 8, Medium: 9, Low: 4
- Overall: **needs-fixes**

The mail/parser layer is well covered (bounce corpus, thread matching, MIME threading, auto-reply heuristics, unsubscribe tokens). Engine safety and tenancy are the largest gaps: no worker package tests at all, load tests are manual-only, and only prospects have cross-org DB tests. Several P1 invariants are implemented in production code but lack regression tests beyond load scripts.

---

## 1. P1 Invariant Coverage

### Scheduler safety (2 workers, no double-send)

| Status | Detail |
|--------|--------|
| **Covered by load test** (not CI) | `scripts/load-test-engine.ts` |
| **Weak load test** | `packages/db/src/load-test-scheduler.ts` |
| **Missing unit test** | `FOR UPDATE SKIP LOCKED` claim path |

**`scripts/load-test-engine.ts`** spawns `--workers=2` with `QUIKSEND_ENGINE_FAKE_MAIL=1` (lines 250-274, 261), seeds active enrollments with pre-captured anchors and `auto_email` steps (lines 140-228), then asserts no duplicate `message.idempotency_key` rows (lines 318-331), no cap breaches, no stuck enrollments, and no dead jobs (lines 333-366). This is the right invariant set for Phase 6 send safety.

**`packages/db/src/load-test-scheduler.ts`** also runs 2 workers (lines 196-204) but seeds **wait-only** steps (lines 99-107) with no outbound sends. Its duplicate-idempotency check (lines 151-160) passes vacuously when no messages are created. It does not prove send-path safety.

**Unit gap:** `apps/worker/src/sequence/tick.ts:9-15` uses `FOR UPDATE SKIP LOCKED`, but no test asserts two concurrent ticks cannot claim the same enrollment.

---

### Idempotency (retried job skips send)

| Status | Detail |
|--------|--------|
| **Missing unit test** | Retry-skip path in `effects.ts` |
| **Covered by load test** (not CI) | Duplicate `idempotency_key` SQL check |

Implementation at `apps/worker/src/sequence/effects.ts:248-268` looks up an existing `message` row by `makeIdempotencyKey(enrollmentId, stepId, attempt)` (`apps/worker/src/sequence/idempotency.ts:21-24`) and, when `status === "sent"`, skips the adapter send and advances state. **No test** replays a job and asserts `adapter.send` is not called a second time.

Load test only checks DB uniqueness post-hoc (`scripts/load-test-engine.ts:318-331`), not the skip-send code path.

---

### Manual anchor capture (Message-Id round-trip + follow-up threading)

| Status | Detail |
|--------|--------|
| **Weak test** | State-machine effect only |
| **Missing integration test** | `captureManualAnchor` DB round-trip |
| **Partial** | MIME threading with anchor |

- **Weak:** `packages/core/src/state-machine/transition.test.ts:32-44` verifies `manual_sent` emits a `capture_anchor` effect but does not touch `captureManualAnchor` or the DB.
- **Missing:** `apps/worker/src/sequence/anchor.ts:17-59` updates `message.enrollmentId`, applies transition effects, and reschedules — no test feeds a real Message-Id through this function and asserts `enrollment.anchorMessageId` / follow-up `In-Reply-To` reference it.
- **Partial (MIME layer):** `packages/mail/src/mime.test.ts:39-52` and `packages/mail/src/adapters/smtp.test.ts:58-86` assert follow-up MIME includes `In-Reply-To` / `References` when an anchor is supplied to `buildMime` / the adapter. These do not connect to `captureManualAnchor`.

---

### Threading headers (follow-up MIME shape)

| Status | Detail |
|--------|--------|
| **Covered** | Unit tests at mail layer |

- `packages/mail/src/threading.test.ts:58-79` — `buildThreadingHeaders` produces `In-Reply-To`, chained `References`, `Re:` subject.
- `packages/mail/src/mime.test.ts:39-52` — raw MIME contains threading headers when `anchor` is set.
- `packages/mail/src/adapters/smtp.test.ts:58-86` — SMTP raw output includes `In-Reply-To`, `References`, `Subject: Re: …`.

---

### Bounce corpus (15 samples)

| Status | Detail |
|--------|--------|
| **Covered** | All 15 fixtures asserted |

- 15 files in `packages/mail/src/bounce.samples/`.
- `packages/mail/src/bounce.test.ts:23-171` lists all 15 with per-sample expectations.
- `packages/mail/src/bounce.test.ts:177-180` sync-checks `readdirSync` count equals `samples.length` (prevents orphan fixtures).
- `packages/mail/src/bounce.test.ts:188-199` runs `it.each` over every bounce and non-bounce sample.

**Note:** `expect(parsed!.diagnostic).toBeTruthy()` at line 198 is a weak assertion (any non-empty string passes) but does not undermine classification coverage.

---

### Thread matching (all priorities)

| Status | Detail |
|--------|--------|
| **Covered** | All four priorities + negative cases |

`packages/mail/src/inbound-matching.test.ts`:

| Priority | Test | Lines |
|----------|------|-------|
| In-Reply-To | `"matches on In-Reply-To (happy path)"` | 42-57 |
| References chain | `"matches on References mid-chain"` | 59-74 |
| providerThreadId | `"matches on providerThreadId when Message-Id does not line up"` | 76-91 |
| Subject heuristic | `"matches via subject heuristic fallback"` | 93-108 |
| No match | `"returns null when nothing matches"` | 110-121 |

---

### Auto-reply detector (vacation-as-topic false positive)

| Status | Detail |
|--------|--------|
| **Covered** | Explicit false-positive test |

`packages/mail/src/auto-reply.test.ts:60-66` — body mentioning "vacation rental package" in a real reply is **not** flagged (`isAutoReply: false`).

---

### CRM writeback (replayed job, no duplicate)

| Status | Detail |
|--------|--------|
| **Missing unit test** | Handler skip + insert dedupe |

Implementation:

- `apps/worker/src/handlers/crm-writeback.ts:224-231` — skips when `crmWritebackLog.status === "succeeded"` for the same `idempotencyKey`.
- `apps/worker/src/sequence/execute-effects.ts:95-107` — `onConflictDoNothing` on `crmWritebackLog.idempotencyKey`.

**No test** replays a writeback job and asserts a single CRM Task/Engagement or a single log row. `packages/integrations/src/sync/upsert.test.ts` covers inbound CRM sync only, not writeback idempotency.

---

### HMAC webhook signing (sign + verify round-trip)

| Status | Detail |
|--------|--------|
| **Missing test** | Quiksend outbound webhook HMAC |

`apps/worker/src/handlers/webhook-deliver.ts:17-38` exports `signWebhookPayload` and `verifyWebhookSignature` (timestamp skew <= 300 s). **No test file** references these symbols.

`packages/integrations/src/webhook.test.ts` tests **Nango inbound** `verifyNangoWebhook` only — different code path.

---

### Unsubscribe token (sign + verify + tampered rejection)

| Status | Detail |
|--------|--------|
| **Covered** | Round-trip + tamper rejection |

`packages/mail/src/unsubscribe.test.ts:13-33` — mint/verify round-trip and tampered token returns `null`.

---

## 2. Tenancy Tests

### Pattern reference

`apps/web/src/lib/prospect-tenancy.test.ts` — uses `withTestOrgs` and asserts org B cannot read/update/soft-delete org A prospects (lines 7-86). Test names are descriptive (e.g. `"org B cannot read org A prospects"`).

### Coverage gaps

| Entity | Tenancy test | Status |
|--------|--------------|--------|
| Prospects | `prospect-tenancy.test.ts` | **Covered** |
| Sequences | — | **Missing** |
| Mailboxes | — | **Missing** |
| CRM connections | — | **Missing** |
| Messages | — | **Missing** |
| Enrollments | — | **Missing** |
| Value prop | — | **Missing** |
| Research profile | — | **Missing** |
| Webhooks | — | **Missing** |
| API keys | — | **Missing** |

Only prospects have cross-org isolation tests. The tenancy CI guard (`packages/db/src/tenancy-guard.test.ts:17-48`) statically scans for `organizationId` filters but does not substitute runtime cross-org tests.

---

## 3. Test Infrastructure

### `withTestOrgs` / `APP_SCOPED_TABLES_TO_TRUNCATE`

`packages/db/src/testing.ts:25-51` truncates 25 app-scoped tables. Cross-check against Drizzle schema:

| App-scoped table | In truncate list | Notes |
|------------------|-------------------|-------|
| company, prospect, list, list_member, import_batch, import_error | yes | |
| crm_connection, sync_state | yes | |
| mailbox, message | yes | |
| sequence, sequence_step, enrollment | yes | |
| task, send_reservation, job_log | yes | |
| value_prop, research_profile, generation, suppression | yes | |
| crm_writeback_log, event | yes | |
| api_key_usage, webhook_endpoint, webhook_delivery | yes | |
| **apikey** | no | Auth table (`packages/db/src/schema/auth.ts:139-140`); keys created in tests would persist |
| app_meta, invitation | no | Likely intentional (global/meta) |
| user, organization, member | no | Intentional — `createTestOrg` creates fresh orgs per test (`testing.ts:73-103`) |

**Gap:** `apikey` is org-scoped (via `referenceId`) but not truncated — potential cross-test leakage if API-key tests are added.

### Tenancy guard vs truncate list mismatch

`packages/db/src/tenancy-guard.test.ts:17-48` omits tables that **are** truncated and queried by the worker:

- `jobLog` / `job_log`
- `sendReservation` / `send_reservation`
- `listMember` / `list_member`
- `importError` / `import_error`

Queries against these tables without `organizationId` would not fail the guard.

### `fileParallelism: false`

**Documented** in `vitest.config.ts:8-10`:

> Serialize DB-touching tests. Tenancy + CRM upsert tests share a Postgres and race in parallel forks (last-write-wins on truncate).

With `fileParallelism: false`, tests run sequentially within the Vitest process. **Residual risk:** `packages/integrations/src/sync/upsert.test.ts:17-19` uses hardcoded `ORG_ID = "org-upsert-test"` (not randomized). Safe today because parallelism is off, but would collide if `fileParallelism` is re-enabled without switching to `withTestOrgs`.

### CI schema sync

`.github/workflows/ci.yml:54-55` runs `pnpm db:migrate` before `pnpm test`. Recent CI on HEAD (`898c7f7`, run #28568892461) completed **success** for the `check` job (lint, format, typecheck, migrate, 154 tests). Schema and migration chain are in sync for that run.

`packages/integrations/src/sync/upsert.test.ts:56-62` also runs `migrate()` in `beforeAll` — redundant with CI but harmless.

---

## 4. Test Quality

### `expect(...).toBe(true)` / vague truthy checks

Found instances (mostly acceptable boolean-return checks, not structural assertions):

| File | Line | Pattern |
|------|------|---------|
| `packages/integrations/src/webhook.test.ts` | 12 | `expect(ok).toBe(true)` on verify result |
| `packages/core/src/schedule/schedule.test.ts` | 34, 39, 97, 110, 119 | window/defer booleans |
| `packages/mail/src/dns.test.ts` | 25-95 | SPF/DKIM/DMARC pass flags |
| `packages/mail/src/bounce.test.ts` | 198 | `toBeTruthy()` on diagnostic (weak) |

No cases where `toBe(true)` masks a broken structural invariant in tenancy or engine code.

### `.skip(` / disabled tests

**None** in project test files (`rg` over `*.test.ts`).

### `TODO` in test files

**None** in project test files.

### Test naming

Good examples: `prospect-tenancy.test.ts` (`"org B cannot read org A prospects"`), `inbound-matching.test.ts` (priority named in each `it`), `auto-reply.test.ts:60` (describes the false-positive scenario).

Weaker/generic: `packages/mail/src/bounce.test.ts:188` uses `it.each(bounceSamples)("$name", …)` — filenames are descriptive but not behavioral.

---

## 5. Integration Test Gaps

| Flow | Coverage |
|------|----------|
| Sign in → workspace → Mailpit → CSV → sequence → enroll → anchor → threaded follow-up | **Missing** — no Playwright/Cypress/e2e harness |
| Bounce round-trip (inject MIME → terminate enrollment + suppression) | **Missing** — bounce parsing is unit-tested only; no worker/inbound handler test |
| API tenancy (org A key → org B id → 404) | **Missing** — no HTTP-level API tests; `resolveApiKey` untested |

Local run: `pnpm test` — 24 files, 154 tests, all passed (2026-07-02).

---

## 6. Load Tests

| Script | CI? | Workers | What it exercises | Invariants |
|--------|-----|---------|-------------------|------------|
| `scripts/load-test-engine.ts` | **No** — manual via `tsx` (see file header line 6) | 2 (default) | Full engine: `auto_email` steps, fake mail, concurrent worker processes | Duplicate `idempotency_key`, cap breaches via `send_reservation`, stuck enrollments, dead `job_log` rows (`318-366`) |
| `packages/db/src/load-test-scheduler.ts` (via `pnpm load-test` / `scripts/load-test-scheduler.ts:5`) | **No** | 2 (default) | Scheduler tick only; **wait** steps, no sends | Duplicate `idempotency_key` on `message`, daily cap, worker crash (`149-212`) |

**Difference:** `load-test-engine` is the Phase 6 send-safety proof (fake mail + real sends + richer invariants). `load-test-scheduler` is a lighter scheduler smoke test whose send invariants are largely inert because no messages are produced.

Neither runs in `.github/workflows/ci.yml` — only `pnpm test` runs in CI.

---

## 7. Test Data Hygiene

| Concern | Finding |
|---------|---------|
| Randomized orgs/emails | `withTestOrgs` uses `randomUUID()` for org/user ids and emails (`packages/db/src/testing.ts:69-82`). Load tests use `@loadtest.local` / `@loadtest.quiksend.local` with UUID suffixes (`scripts/load-test-engine.ts:61-62, 186`). |
| Fixed IDs | `packages/integrations/src/sync/upsert.test.ts:17-19` — hardcoded `ORG_ID`, `USER_ID`, `CONNECTION_ID`. Safe with `fileParallelism: false`. |
| Unfrozen time | `packages/integrations/src/sync/upsert.test.ts:150` uses `Date.now() - 2h` for precedence window — relative, not flaky. `packages/core/src/schedule/schedule.test.ts` uses fixed ISO dates. `packages/core/src/state-machine/transition.test.ts` uses `new Date()` for event timestamps — acceptable for state-machine logic with no wall-clock assertions. |

---

## P2 Items

| Item | Status |
|------|--------|
| Schema-parse retry in `generate-email.ts` | **Missing** — `packages/ai/src/generation/generate-email.ts:19-37` retries up to `MAX_RETRIES = 2`; no test in `packages/ai/` |
| Migration migrate-then-rollback | **Missing** — no forward-only / no-leaky-state test; `upsert.test.ts` only migrates forward |
| Fake vs real mail adapters | **OK for unit tests** — `smtp.test.ts:9-13` mocks nodemailer; `gmail.test.ts:13-20` mocks Nango; no unit test hits real SMTP |
| DB mocks in helpers | **OK** — tenancy and upsert tests use real Postgres via `@quiksend/db`; no drizzle-orm mock drift observed |

---

## Findings

### [TEST-001] No worker package tests — engine invariants untested at unit level
- Location: `apps/worker/src/sequence/` (entire tree; 0 `*.test.ts` files)
- Severity: high
- What: Phase 6 engine (`tick`, `effects`, `reserve-slot`, `anchor`, `idempotency`) has zero unit or integration tests. All safety proofs rely on manual load scripts.
- Impact: Regressions in claim SQL, idempotency skip-send, or anchor capture ship without CI signal.
- Fix: Add `apps/worker/src/sequence/*.test.ts` covering at minimum: idempotency skip-send (`effects.ts:248-268`), `captureManualAnchor` DB effects (`anchor.ts:17-59`), and advisory-lock/cap logic in `reserve-slot.ts`.
- Confidence: high

### [TEST-002] Load tests not in CI
- Location: `.github/workflows/ci.yml:57-58`; `package.json:24` (`"load-test": "pnpm --filter @quiksend/db load-test"`)
- Severity: high
- What: CI runs `pnpm test` only. `scripts/load-test-engine.ts` and `load-test-scheduler.ts` are manual.
- Impact: Double-send / cap-breach regressions merge if unit tests pass but concurrency invariants break.
- Fix: Add a CI job (or nightly) that runs `load-test-engine.ts` with reduced `--enrollments` / `--duration` against the CI Postgres service.
- Confidence: high

### [TEST-003] Idempotency skip-send path has no unit test
- Location: `apps/worker/src/sequence/effects.ts:248-268`
- Severity: high
- What: When a retried job finds an existing `message` with matching `idempotencyKey` and `status === "sent"`, send is skipped. No test asserts this branch.
- Impact: A refactor could remove the guard and load tests might not catch it until a manual load run.
- Fix: Unit test with mocked adapter/tx: insert sent message with key, call send effect twice, assert adapter invoked once.
- Confidence: high

### [TEST-004] `captureManualAnchor` lacks DB integration test
- Location: `apps/worker/src/sequence/anchor.ts:17-59`; `packages/core/src/state-machine/transition.test.ts:32-44`
- Severity: high
- What: State machine test verifies `capture_anchor` effect emission only. No test round-trips a Message-Id through `captureManualAnchor` and verifies enrollment anchor fields + follow-up threading inputs.
- Impact: Message-Id mismatch between manual send and auto follow-ups could reach production undetected.
- Fix: DB integration test: seed `waiting_manual` enrollment + outbound message, call `captureManualAnchor`, assert `enrollment.anchorMessageId` and that a subsequent auto step builds `In-Reply-To` from it.
- Confidence: high

### [TEST-005] CRM writeback replay not tested
- Location: `apps/worker/src/handlers/crm-writeback.ts:224-231`; `apps/worker/src/sequence/execute-effects.ts:95-107`
- Severity: high
- What: Idempotent skip and `onConflictDoNothing` exist but no test replays a writeback job.
- Impact: Duplicate CRM Tasks/Engagements on pg-boss retry.
- Fix: Test handler with seeded `crm_writeback_log` row (`status: succeeded`); assert no second external call. Test `insertWritebackLog` conflict path.
- Confidence: high

### [TEST-006] Quiksend HMAC webhook sign/verify untested
- Location: `apps/worker/src/handlers/webhook-deliver.ts:17-38`
- Severity: high
- What: `signWebhookPayload` / `verifyWebhookSignature` have no tests (timestamp skew, tampered payload, wrong secret).
- Impact: Signature format or replay-window bugs break webhook consumers silently.
- Fix: Mirror `packages/integrations/src/webhook.test.ts` pattern for Quiksend HMAC functions.
- Confidence: high

### [TEST-007] Tenancy tests cover prospects only
- Location: `apps/web/src/lib/prospect-tenancy.test.ts` (sole entity tenancy test file)
- Severity: high
- What: Sequences, mailboxes, CRM connections, messages, enrollments, value_prop, research_profile, webhooks, and API keys lack cross-org DB tests.
- Impact: `organizationId` filter bugs on non-prospect tables leak data across tenants.
- Fix: Extend `*-tenancy.test.ts` pattern per entity using `withTestOrgs`.
- Confidence: high

### [TEST-008] `load-test-scheduler` does not exercise send path
- Location: `packages/db/src/load-test-scheduler.ts:99-107`, `149-160`
- Severity: medium
- What: Wait-only sequences produce no outbound messages; duplicate-idempotency and cap checks are inert for sends.
- Impact: False confidence if only `pnpm load-test` is run, not `load-test-engine.ts`.
- Fix: Document that `load-test-engine.ts` is the authoritative send-safety script; or align scheduler script to use `auto_email` + fake mail like the engine script.
- Confidence: high

### [TEST-009] Tenancy guard omits worker-queried tables
- Location: `packages/db/src/tenancy-guard.test.ts:17-48` vs `packages/db/src/testing.ts:35-47`
- Severity: medium
- What: `jobLog`, `sendReservation`, `listMember`, `importError` are truncated but not in `APP_SCOPED_TABLES` guard list.
- Impact: Unscoped queries against these tables won't fail CI guard.
- Fix: Add missing entries to `APP_SCOPED_TABLES` in `tenancy-guard.test.ts`.
- Confidence: high

### [TEST-010] `apikey` table not truncated between tests
- Location: `packages/db/src/testing.ts:25-51`; `packages/db/src/schema/auth.ts:139-140`
- Severity: medium
- What: Phase 10 API keys live in `apikey` but are absent from `APP_SCOPED_TABLES_TO_TRUNCATE`.
- Impact: Future API-key tests could leak keys across test cases.
- Fix: Add `"apikey"` to truncate list (or delete by org in test teardown).
- Confidence: medium

### [TEST-011] No end-to-end or inbound bounce integration tests
- Location: (absent)
- Severity: medium
- What: No test covers sign-in → enroll → anchor → threaded send, or inject bounce MIME → enrollment terminated + suppression row.
- Impact: Cross-package wiring bugs (poller, worker, web) only surface manually.
- Fix: Add focused integration tests against CI Postgres + fake mail adapter.
- Confidence: high

### [TEST-012] No HTTP API tenancy tests
- Location: (absent); API key resolution in `apps/web/` (untested)
- Severity: medium
- What: No test issues real HTTP request with org A API key against org B resource id.
- Impact: API scoping bugs (P1 invariant #9 in `review/CONTEXT.md:44`) untested.
- Fix: Supertest/vitest HTTP test against route handlers with seeded keys and cross-org ids expecting 404.
- Confidence: high

### [TEST-013] `generateEmail` schema-parse retry untested (P2)
- Location: `packages/ai/src/generation/generate-email.ts:19-37`
- Severity: medium
- What: Retry loop on schema parse failure has no test.
- Impact: Retry logic could be removed or broken without CI failure.
- Fix: Mock `generateObject` to throw once then succeed; assert two calls.
- Confidence: high

### [TEST-014] Bounce diagnostic assertion is weak
- Location: `packages/mail/src/bounce.test.ts:198`
- Severity: low
- What: `expect(parsed!.diagnostic).toBeTruthy()` accepts any non-empty string.
- Impact: Diagnostic content could regress without detection.
- Fix: Assert substring or snapshot per sample.
- Confidence: medium

### [TEST-015] `upsert.test.ts` uses fixed org ids
- Location: `packages/integrations/src/sync/upsert.test.ts:17-19`
- Severity: low
- What: Hardcoded `ORG_ID` / `USER_ID` instead of `withTestOrgs` random ids.
- Impact: Latent collision if test parallelism is re-enabled.
- Fix: Migrate to `withTestOrgs` or random ids per suite.
- Confidence: medium

### [TEST-016] No migration rollback / idempotency test (P2)
- Location: `packages/db/drizzle/` (12 migrations); no test file
- Severity: low
- What: Migrations run forward in CI and in `upsert.test.ts:61` but nothing verifies re-run safety or absence of leaky state.
- Impact: Broken migration could pass if only latest schema is exercised once.
- Fix: Optional CI step: migrate on empty DB twice, or test migrate-from-baseline.
- Confidence: low

### [TEST-017] Nango webhook tests mistaken for Quiksend HMAC coverage
- Location: `packages/integrations/src/webhook.test.ts:1-39`
- Severity: low
- What: Existing webhook tests cover inbound Nango HMAC only, not outbound Quiksend delivery signing.
- Impact: Reviewers may assume webhook crypto is fully tested.
- Fix: Add separate test file for `webhook-deliver.ts` crypto helpers (see TEST-006).
- Confidence: high

---

## P1 Invariant Scorecard

| Invariant | Regression test? | Quality |
|-----------|------------------|---------|
| Scheduler / no double-send (2 workers) | Load test only (`load-test-engine`) | Covered by load test, not CI |
| Send idempotency key skip | No | **Missing** |
| Manual anchor Message-Id round-trip | State machine only | **Weak / missing integration** |
| Follow-up MIME threading | Yes (mail unit tests) | **Covered** |
| Bounce corpus (15 samples) | Yes | **Covered** |
| Thread matching (4 priorities) | Yes | **Covered** |
| Auto-reply vacation false positive | Yes | **Covered** |
| CRM writeback replay dedupe | No | **Missing** |
| HMAC webhook sign/verify | No | **Missing** |
| Unsubscribe token | Yes | **Covered** |
| API key org scoping | No | **Missing** |
| Tenancy (all entities) | Prospects only | **Gap** |
