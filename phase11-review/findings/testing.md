# Testing Review Findings

## Summary

- **Files reviewed**: 15 Phase 11 test touchpoints (9 new `.test.ts` files + 6 modified), `scripts/load-test-engine.ts`, `packages/db/src/testing.ts`, `packages/db/src/tenancy-guard.test.ts`, Phase 11 spec Testing sections, Wave 7 briefs
- **Phase 11 test file inventory** (git `d89d5e4..6a4f33f`):
  - **9 added**: `packages/mail/src/gateway-detect.test.ts`, `packages/mail/src/content-sanitizer.test.ts`, `packages/core/src/deliverability/auto-pause.test.ts`, `packages/core/src/deliverability/mailbox-safety.test.ts`, `apps/worker/src/sequence/mailbox-router.test.ts`, `apps/worker/src/sequence/reserve-slot.test.ts`, `apps/worker/src/sequence/seg-routing.integration.test.ts`, `apps/worker/src/handlers/gateway-detect.test.ts`, `apps/worker/src/handlers/canary-check.test.ts`
  - **6 modified**: `entry-conditions.test.ts`, `transition.test.ts`, `mime.test.ts`, `tenancy-guard.test.ts`, `mailboxes.functions.test.ts` (fixture fields only)
  - **PR claim check**: CONTEXT cites “15 new test files” — git shows **9 added** and **4 modified with substantive new cases** (12 meaningful touchpoints). The extra `seg-routing.integration.test.ts` and `reserve-slot.test.ts` are not all enumerated in individual Wave 7 brief file lists.
- **Critical**: 0, **High**: 6, **Medium**: 9, **Low**: 3
- **Overall**: **needs-fixes**

P1 pure-domain modules (gateway fingerprinting, auto-pause evaluator, mailbox-safety, entry-condition predicates) are largely well covered. The largest gaps are **11C canary lifecycle** (polling, injection, snapshots, tenancy), **incomplete routing decision-table coverage**, and **load-test modes declared but not implemented**.

---

## Findings

### [TEST-001] `canary-check.test.ts` does not test the canary-check handler

- **Location**: `apps/worker/src/handlers/canary-check.test.ts:1-19`
- **Severity**: high
- **Confidence**: high
- **What**: The only test in this file imports `evaluateAutoPause` from `@quiksend/core/deliverability` and asserts a pause decision. It never imports or exercises `runCanaryCheck`, `pollSeed`, `applyCanaryMatches`, or the 24-hour silent-drop sweep in `canary-check.ts`. The file duplicates coverage already present in `packages/core/src/deliverability/auto-pause.test.ts`.
- **Impact**: The Phase 11C P1 invariant “canary polling arrival detection” has no automated regression guard. A broken IMAP poll loop, incorrect silent-drop SQL, or a regression in `refreshDeliverabilitySnapshots` coupling would ship unnoticed.
- **Fix**: Replace the stub with handler-level tests that mock `db` + `searchCanaryMessages`, set `QUIKSEND_CANARY_IMAP_MOCK`, seed `canary_send`/`seed_inbox` rows via `withTestOrgs`, and assert `arrival_status` transitions and snapshot side effects.

---

### [TEST-002] Canary IMAP arrival paths (inbox / spam / silent-drop / bounce) untested

- **Location**: `apps/worker/src/deliverability/seed-imap.ts:38-57`, `apps/worker/src/handlers/canary-check.ts:30-59`, `apps/worker/src/handlers/canary-check.test.ts:1-19`
- **Severity**: high
- **Confidence**: high
- **What**: `searchCanaryMessages` supports mock modes `inbox` and `not_found` via `QUIKSEND_CANARY_IMAP_MOCK`, but there is **no `spam` mock mode** and no test file exercises any mock path. The spec-required cases — `arrived_inbox`, `arrived_spam`, `silent_drop` after 24h, and DSN bounce matching a canary token — have zero test coverage. A repo-wide search finds no inbound handler that matches `X-Quiksend-Canary-Id` or sets `canary_send.arrival_status = 'bounced'` (the enum value exists at `packages/db/src/schema/deliverability-enums.ts:26` but no production path sets it).
- **Impact**: Silent-drop false positives, missed spam-folder arrivals, and bounce attribution bugs are undetectable in CI.
- **Fix**: Add `seed-imap.test.ts` for `classifyArrivalFolder` + mock modes; extend `canary-check.test.ts` to call `runCanaryCheck` with frozen time for the 24h sweep; implement and test bounce matching if still required by spec, or document deferral explicitly.

---

### [TEST-003] Canary injection during enroll has no tests

- **Location**: `apps/web/src/lib/canary-injection.ts:23-118`
- **Severity**: high
- **Confidence**: high
- **What**: `injectCanariesForEnrollment` implements SEG mix analysis (`minProspectsPerSeg`), user-vs-provider seed rotation (`isProEntitled`), and `pickRandomPositions` for M random step positions. No `canary-injection.test.ts` exists; `sequences.functions.test.ts` does not exist; `mailboxes.functions.test.ts` only gained fixture fields for `enterpriseSafe*` columns.
- **Impact**: Incorrect canary counts, wrong seed pool selection (user vs provider), or threshold gating bugs would reach production without regression signal.
- **Fix**: Add `apps/web/src/lib/canary-injection.test.ts` using `withTestOrgs`, seed prospects with SEG gateways, user/provider `seed_inbox` rows, and assert `canary_send` row counts, `seedInboxId` rotation order, and enqueued `canary.send` jobs.

---

### [TEST-004] Mailbox routing decision table is partially covered

- **Location**: `apps/worker/src/sequence/mailbox-router.test.ts:127-354`, `apps/worker/src/sequence/mailbox-router.ts:87-122`
- **Severity**: medium
- **Confidence**: high
- **What**: Seven integration cases cover off/warn/enforce branches, anchor exception, same-provider tie-breaking, and non-SEG passthrough. Missing explicit cases for: **(a)** `enforce` + SEG + safe mailboxes exist + **current mailbox already safe** → route without swap (`mailbox-router.ts:103-105`); **(b)** same for `warn`; **(c)** **least-loaded** ranking when load counts differ (only tie + same-provider is tested at `mailbox-router.test.ts:271-328`); **(d)** `enforce` + anchor-bound enrollment (only `warn` + anchor tested at `mailbox-router.test.ts:238-268`).
- **Impact**: Subtle routing regressions on the “already safe” fast path or load-based ranking could mis-route SEG sends without failing CI.
- **Fix**: Add parametrized table tests for the four missing cells; seed unequal `send_reservation` counts to prove least-loaded selection beats same-provider tie logic.

---

### [TEST-005] Content sanitizer missing image-cap and selective-pixel tests

- **Location**: `packages/mail/src/content-sanitizer.test.ts:33-45`, `packages/mail/src/content-sanitizer.ts:117-120`
- **Severity**: medium
- **Confidence**: high
- **What**: Tests cover tracking-pixel strip, external-image strip, plain-text preference, and a combined multipart case. Missing: **(a)** data-URI image **> 100KB** stripped while **< 100KB** kept (logic at `content-sanitizer.ts:117-120`); **(b)** `stripTrackingPixel: true` with a non-tracking external image present — spec requires stripping Quiksend tracking while keeping other images; current test at `content-sanitizer.test.ts:5-18` uses a single tracking `<img>` so it cannot distinguish the two behaviors; **(c)** no tests for async `sanitizeForSegAsync` network inlining path.
- **Impact**: SEG-bound sends may retain oversized inline images or strip legitimate branding images.
- **Fix**: Add fixtures with dual `<img>` tags (tracking domain + CDN) and a padded `data:image/png;base64,...` exceeding `MAX_INLINE_IMAGE_BYTES`.

---

### [TEST-006] Gateway worker handler lifecycle incomplete in tests

- **Location**: `apps/worker/src/handlers/gateway-detect.test.ts:80-134`, `apps/worker/src/handlers/gateway-detect.ts:105-223`
- **Severity**: medium
- **Confidence**: high
- **What**: One integration test covers bulk detect → cache dedup (20 domains from 200 emails) → `apply_classification` back-fill. Not tested: **`gateway.detect_single`** cache-miss path (`gateway-detect.ts:105-123`), **`gateway.sweep_stale`** re-classification of expired rows (`gateway-detect.ts:203-223`), or cache-hit short-circuit inside `apply_classification` (`gateway-detect.ts:179-199`).
- **Impact**: Stale classification TTL sweep and single-email detect regressions would not fail CI until production DNS/cache drift.
- **Fix**: Add cases that insert expired `gateway_classification` rows, invoke the sweep handler, and assert re-detection; add a single-email detect test with a cold cache.

---

### [TEST-007] Entry conditions lack combined `if_no_reply` + gateway predicate test

- **Location**: `packages/core/src/state-machine/entry-conditions.test.ts:17-74`
- **Severity**: low
- **Confidence**: high
- **What**: Gateway allow/deny/null handling is tested in isolation. No case combines `{ kind: "if_no_reply", recipientGatewayIn: [...] }` (or deny variant) with a replied thread to verify predicate ordering/short-circuit.
- **Impact**: Low — individual predicates work, but a composition bug could slip through.
- **Fix**: Add one test with `hasReplyOnThread: true` plus gateway predicates and assert `if_no_reply` wins.

---

### [TEST-008] Auto-pause per-(sequence, mailbox, gateway) grouping untested at handler level

- **Location**: `apps/worker/src/handlers/canary-check.ts:132-191`, `packages/core/src/deliverability/auto-pause.test.ts:12-63`
- **Severity**: medium
- **Confidence**: high
- **What**: `evaluateAutoPause` unit tests cover threshold, insufficient samples, and edge percentages. The SQL `GROUP BY cs.sequence_id, cs.mailbox_id, si.gateway` in `maybePauseCampaigns` — the actual per-group auto-pause trigger — has no integration test. `canary-check.test.ts` does not exercise it.
- **Impact**: A broken `GROUP BY` or wrong join could pause the wrong campaign or fail to pause when one gateway/mailbox pair breaches threshold.
- **Fix**: Seed `canary_send` rows across two gateways with divergent arrival rates; call `maybePauseCampaigns` and assert only the breaching sequence pauses.

---

### [TEST-009] Spec tenancy tests for Phase 11 deliverability data are absent

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:601-603`, `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1569-1571`
- **Severity**: high
- **Confidence**: high
- **What**: Spec calls for `apps/web/src/lib/gateway-tenancy.test.ts` and `deliverability-tenancy.test.ts`. Neither file exists. `getDeliverabilityGrid` and seed-inbox server fns in `deliverability.functions.ts` / `seed-inbox.functions.ts` scope by `organizationId` via `orgFn`, but no cross-org negative tests prove org B cannot read org A's `seed_inbox`, `canary_send`, or `deliverability_snapshot` rows.
- **Impact**: Tenancy regressions on new Phase 11 tables would not fail CI (Wave 5 TEST-015 pattern not extended).
- **Fix**: Add `deliverability-tenancy.test.ts` using `withTestOrgs` following `prospect-tenancy.test.ts` patterns; assert 404/empty for cross-org grid and seed reads.

---

### [TEST-010] Seed IMAP credential crypto has no round-trip test

- **Location**: `packages/mail/src/seed-crypto.ts:11-40`
- **Severity**: medium
- **Confidence**: high
- **What**: Phase 11C spec lists “seed pool crypto” unit tests. `encryptSeedImapConfig` / `decryptSeedImapConfig` wrap SMTP crypto with separate user vs system keys (`resolveSeedEncryptionKey`). `packages/mail/src/crypto.test.ts` covers SMTP only; no `seed-crypto.test.ts` exists.
- **Impact**: Key-resolution bugs (user vs provider-managed `organizationId: null`) could corrupt seed credentials silently.
- **Fix**: Mirror `crypto.test.ts` with `MAILBOX_ENCRYPTION_KEY` and `SYSTEM_SEED_ENCRYPTION_KEY` fixtures; assert cross-key decryption fails.

---

### [TEST-011] Canary load-test modes declared but not wired

- **Location**: `scripts/load-test-engine.ts:53-54`, `scripts/load-test-engine.ts:95-100`, `scripts/load-test-engine.ts:918-934`
- **Severity**: high
- **Confidence**: high
- **What**: `TestMode` union includes `canary-happy-path` and `canary-auto-pause`. `parseArgs` adjusts workspace/enrollment counts when `testMode.startsWith("canary-")` (`load-test-engine.ts:95-100`), but `main()` has no branch for either mode — they fall through to the default `assertHappyPathInvariants()` path (`load-test-engine.ts:932-933`). No seed fixture, IMAP mock, or auto-pause assertion exists.
- **Impact**: Spec exit criteria for 11C load tests are unverifiable in CI or local automation; docs/spec imply working modes.
- **Fix**: Add `seedCanaryFixture`, dedicated invariant functions (100 canaries / 5 seeds; silent-drop triggers pause after 3), and `case "canary-happy-path"` / `case "canary-auto-pause"` in the switch — or remove modes from the type union and update spec/docs.

---

### [TEST-012] `gateway-detection` load-test mode from spec not implemented

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:604-606`, `scripts/load-test-engine.ts:47-54`
- **Severity**: medium
- **Confidence**: high
- **What**: Phase 11A spec requires `--test-mode=gateway-detection` seeding 500 prospects across 50 domains with a 30s completion assertion. `load-test-engine.ts` implements `seg-routing` (`load-test-engine.ts:850-864`) but has no `gateway-detection` mode in the type union or switch.
- **Impact**: 11A classification throughput invariant is manual-only.
- **Fix**: Add mode parallel to `seg-routing` that enqueues bulk detect jobs and polls until all prospects have `email_gateway` set.

---

### [TEST-013] Phase 11 tables missing from test truncation list

- **Location**: `packages/db/src/testing.ts:25-52`
- **Severity**: medium
- **Confidence**: high
- **What**: `APP_SCOPED_TABLES_TO_TRUNCATE` does not include `seed_inbox`, `canary_send`, or `deliverability_snapshot`. `tenancy-guard.test.ts` correctly lists `seedInbox`, `canarySend`, `deliverabilitySnapshot` in `APP_SCOPED_TABLES` (`tenancy-guard.test.ts:52-55`), but `withTestOrgs` truncation will not clear Phase 11C rows between tests.
- **Impact**: Flaky or order-dependent failures as Phase 11 DB integration tests accumulate; potential cross-test leakage of canary/snapshot data.
- **Fix**: Append `seed_inbox`, `canary_send`, `deliverability_snapshot` to `APP_SCOPED_TABLES_TO_TRUNCATE` (respect FK order — `canary_send` before `seed_inbox` or use `CASCADE`).

---

### [TEST-014] Deliverability snapshot rollup untested

- **Location**: `apps/worker/src/handlers/deliverability-snapshot.ts:16-61`
- **Severity**: medium
- **Confidence**: high
- **What**: `refreshDeliverabilitySnapshots` performs the 7-day rolling `INSERT … ON CONFLICT DO UPDATE` aggregation. No test invokes it or asserts `deliverability_snapshot` row math (`canary_delivered`, `canary_silent_dropped`, `deliverability_pct`).
- **Impact**: Grid UI could show stale or incorrect percentages without CI catching SQL regressions.
- **Fix**: Seed `canary_send` rows with mixed `arrival_status` values; call `refreshDeliverabilitySnapshots`; assert snapshot counts and `deliverability_pct`.

---

### [TEST-015] Phase 11 webhook events lack fanout / payload tests

- **Location**: `packages/db/src/schema/api.ts:25-29`, `apps/worker/src/handlers/webhook-deliver.test.ts:1-48`
- **Severity**: medium
- **Confidence**: medium
- **What**: Four Phase 11 events are registered in `SUPPORTED_WEBHOOK_EVENTS`. `webhook-deliver.test.ts` covers HMAC signing only. No test asserts `execute-effects` or event insertion enqueues deliveries for `enrollment.no_safe_mailbox_for_gateway`, `deliverability.canary.arrived`, `deliverability.canary.silent_drop`, or `gateway.detected`, nor that payloads exclude seed IMAP credentials.
- **Impact**: Webhook subscribers may never receive deliverability signals; credential leakage in payload construction would go unnoticed.
- **Fix**: Extend `effect-executor.test.ts` or add webhook integration tests that emit each Phase 11 event type and assert delivery payload shape.

---

### [TEST-016] PR “15 new test files” claim does not match git

- **Location**: `phase11-review/CONTEXT.md:61`
- **Severity**: low
- **Confidence**: high
- **What**: Git `diff-filter=A` on `*.test.ts` between `d89d5e4` and `6a4f33f` yields **9** new files. Counting substantive extensions (`entry-conditions`, `transition`, `mime`, `gateway-detect` worker) reaches ~12 touchpoints, not 15.
- **Impact**: Review/completeness tracking overstated test surface area.
- **Fix**: Update release/PR notes to “9 new + 4 extended” or add the missing 3–6 test files the claim implies.

---

### [TEST-017] `gateway_classification` correctly excluded from tenancy guard

- **Location**: `packages/db/src/tenancy-guard.test.ts:17-56`
- **Severity**: low
- **Confidence**: high
- **What**: Shared cache table `gatewayClassification` is intentionally absent from `APP_SCOPED_TABLES`. This matches spec (“cache is shared — assert it” at `Quiksend-Implementation-Plan-Phase-11.md:601-603`). No action required; documented for completeness reviewers.
- **Impact**: None — correct design.
- **Fix**: None. Optionally add a positive test that shared cache rows are visible across orgs when that tenancy test file lands.

---

## P1 Invariant Checklist (brief cross-walk)

| #   | Invariant                                                              | Status                                                                                                                                       |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gateway detection cascade (`gateway-detect.test.ts`)                   | **Covered** — 8 SEG fingerprints + Google/M365 + split-brain + timeout/SERVFAIL/empty MX (`packages/mail/src/gateway-detect.test.ts:24-110`) |
| 2   | Routing decision table (`mailbox-router.test.ts`)                      | **Partial** — see TEST-004                                                                                                                   |
| 3   | Content sanitizer transformations                                      | **Partial** — see TEST-005                                                                                                                   |
| 4   | Entry conditions gateway predicates                                    | **Mostly covered** — null/allow/deny; combined `if_no_reply` gap (TEST-007)                                                                  |
| 5   | Auto-pause evaluator                                                   | **Covered** at unit level (`auto-pause.test.ts`); handler grouping gap (TEST-008)                                                            |
| 6   | Mailbox safety helper                                                  | **Covered** (`mailbox-safety.test.ts:16-41`)                                                                                                 |
| 7   | Canary polling arrival detection                                       | **Not covered** — TEST-001, TEST-002                                                                                                         |
| 8   | Gateway detect worker handlers                                         | **Partial** — bulk+apply yes; single+sweep no (TEST-006)                                                                                     |
| 9   | Canary injection on enroll                                             | **Not covered** — TEST-003                                                                                                                   |
| 10  | Deliverability HTTP API tenancy                                        | **N/A for REST** per `docs/api.md`; server-fn tenancy tests missing (TEST-009)                                                               |
| 11  | Weak assertions in new tests                                           | **Acceptable** — `toBe(true)` uses are on `.some()`/`.every()` booleans, not vacuous success checks                                          |
| 12  | Fixture data quality                                                   | **Good** — Phase 11 DB tests use `withTestOrgs` + `randomUUID()`; no hardcoded org IDs observed                                              |
| 13  | Silent-drop 24h / snapshot / webhook fanout / least-loaded / IMAP pool | **Gaps** — TEST-002, TEST-004, TEST-014, TEST-015; no IMAP pool in codebase (new connection per poll at `seed-imap.ts:61-100`)               |
| 14  | Canary load-test modes                                                 | **Not wired** — TEST-011                                                                                                                     |
| 15  | `APP_SCOPED_TABLES` completeness                                       | **OK** (`tenancy-guard.test.ts:52-55`)                                                                                                       |
| 16  | `APP_SCOPED_TABLES_TO_TRUNCATE`                                        | **Missing 3 tables** — TEST-013                                                                                                              |

---

## Positive observations

- **`packages/mail/src/gateway-detect.test.ts`** is thorough: parametrized SEG fingerprints, split-brain Proofpoint-over-Google, and DNS failure modes all match the 11A spec checklist.
- **`packages/core/src/deliverability/auto-pause.test.ts`** and **`mailbox-safety.test.ts`** are clean pure-function tests with meaningful edge cases (minimum sample size, threshold boundary, auto-downgrade override).
- **`apps/worker/src/sequence/seg-routing.integration.test.ts`** delivers real end-to-end value: 20 anchor-bound SEG enrollments pause under `enforce` with no safe mailbox, emit `enrollment.no_safe_mailbox_for_gateway` events, then prove auto-swap after a safe mailbox is added.
- **`apps/worker/src/sequence/reserve-slot.test.ts`** validates Phase 11B SEG sub-cap and 5-minute same-domain gap with concrete defer assertions.
- **`--test-mode=seg-routing`** in `scripts/load-test-engine.ts` is fully wired with dedicated seed data and `runSegRoutingReservationStress` invariants — a good pattern the canary modes should follow.
- **Tenancy guard** was updated for all three org-scoped Phase 11C tables while correctly leaving shared `gateway_classification` out.
- **Wave 5 `withTestOrgs` pattern** is consistently used in new worker integration tests (`mailbox-router.test.ts`, `gateway-detect.test.ts`, `seg-routing.integration.test.ts`, `reserve-slot.test.ts`).
