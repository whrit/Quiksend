# TESTING REVIEW — Phase 11

## Task

Read-only review of the Phase 11 test coverage. Write findings to
`phase11-review/findings/testing.md` following the format in `phase11-review/CONTEXT.md`.

## Focus areas

### P1 — coverage of P1 invariants

Every one of these is a "must have a test" from the Phase 11 spec:

1. **Gateway detection cascade** (`packages/mail/src/gateway-detect.test.ts`)
   - Test each SEG fingerprint (Proofpoint, Mimecast, Barracuda, Cisco, etc.)
   - Test split-brain case (Proofpoint MX + Google storage → returns proofpoint)
   - Test MX timeout → returns unknown
   - Test SERVFAIL → returns unknown
   - Test empty MX → returns unknown

2. **Routing decision table** (`apps/worker/src/sequence/mailbox-router.test.ts`)
   - Test all 5 policy states × recipient gateway (SEG vs non-SEG) × safe mailbox availability × current mailbox safety = full decision table
   - Test anchor-threading exception (auto-swap disabled when `anchor_message_id IS NOT NULL`)
   - Test auto-swap ranking (least-loaded + same-provider preference)

3. **Content sanitizer** (`packages/mail/src/content-sanitizer.test.ts`)
   - Test each transformation independently
   - Test the sanitizer preserves valid MIME
   - Test image size cap (< 100KB inline, > 100KB strip)
   - Test tracking pixel pattern (strip Quiksend tracking, keep other images)

4. **Entry conditions extension** (`packages/core/src/state-machine/entry-conditions.test.ts`)
   - Test `recipientGatewayIn` allow-list logic
   - Test `recipientGatewayNotIn` deny-list logic
   - Test null gateway handling
   - Test combined with existing `if_no_reply` predicate

5. **Auto-pause evaluator** (`packages/core/src/deliverability/auto-pause.test.ts`)
   - Test threshold breach fires
   - Test insufficient data → no action
   - Test divide-by-zero safety
   - Test per-(sequence, mailbox, gateway) grouping

6. **Mailbox safety helper** (`packages/core/src/deliverability/mailbox-safety.test.ts`)
   - Test all 4 combinations of (mailbox safe/unsafe × gateway SEG/non-SEG)
   - Test auto-downgraded overrides enterprise_safe

### P1 continued — integration + e2e

7. **Canary polling arrival detection** (`apps/worker/src/handlers/canary-check.test.ts`)
   - Test IMAP mock returning arrived message → status `arrived_inbox`
   - Test IMAP mock returning message in spam folder → `arrived_spam`
   - Test IMAP mock returning nothing after 24h → `silent_drop`
   - Test bounce path (DSN inbound matching canary token)

8. **Gateway detection worker handlers** (`apps/worker/src/handlers/gateway-detect.test.ts`)
   - Test single detection + cache miss (mock DNS)
   - Test bulk detection dedupes by domain
   - Test apply_classification back-fills all prospects at a domain
   - Test sweep_stale re-classifies expired rows

9. **Canary injection during enroll** (extend `sequences.functions.test.ts` if exists, or new file)
   - Test SEG mix analysis triggers canary injection at correct thresholds
   - Test seed rotation (user seeds first, provider seeds if Pro)
   - Test M random positions per campaign

### P1 continued — HTTP API tenancy (already-established pattern)

10. **Deliverability HTTP API tests** — if Phase 11 added any new API routes, verify tenancy tests exist (org A cross-org read returns 404)
    - Actually: Phase 11 explicitly did NOT add new REST endpoints (per api.md update). If tests exist, verify they DO test the constraint that no deliverability data is accessible via /api/v1/\*
    - If not tested: confirm no data leaks through webhooks (payload construction sanitized)

### P2 — quality of new tests

11. **Weak assertion sweep in new Phase 11 tests**
    - Look for `expect(x).toBe(true)` patterns without structural assertion
    - Verify each new test file has meaningful edge case coverage

12. **Fixture data quality**
    - Any new tests using hardcoded UUIDs? (Wave 5 TEST-015 established `withTestOrgs` pattern — Phase 11 tests should follow)
    - Any tests polluting shared state between runs?

### P2 continued — coverage gaps

13. **What is NOT tested?**
    - Silent-drop detection latency (24h sweep) — is there a test proving it fires at the right time?
    - Deliverability snapshot refresh — the 15-min rollup. Is there a test?
    - `SUPPORTED_WEBHOOK_EVENTS` fanout — do Phase 11 events actually get delivered end-to-end? Any integration test?
    - Auto-swap same-provider ranking — is the M365→M365 preference tested?
    - IMAP connection reuse — pool behavior tested?

### P2 continued — CI load test extensions

14. **Load-test canary modes**
    - Spec called for `--test-mode=canary-happy-path` and `--test-mode=canary-auto-pause`
    - My session note: PHI's load-test extension had an unused fixture function that I removed during merge
    - Verify: are these load-test modes actually wired? Or just declared in the type union without switch-case handling?
    - If not wired: flag as `TEST-011` "canary load-test modes declared but not wired"

### P3 — informational

15. **APP_SCOPED_TABLES completeness**
    - Wave 5 ZETA extended `packages/db/src/tenancy-guard.test.ts` `APP_SCOPED_TABLES`
    - Phase 11 added 3 org-scoped tables: `seed_inbox`, `canary_send`, `deliverability_snapshot`
    - Verify all 3 are included in the tenancy guard's app-scoped list
    - `gateway_classification` is SHARED (no org filter) — verify it's NOT in the tenancy guard list (that would fail)

16. **`APP_SCOPED_TABLES_TO_TRUNCATE`** in `packages/db/src/testing.ts`
    - Same 3 tables need to be truncated between test runs to avoid leakage
    - Verify all 3 present

## Do

- List every new test file added in Wave 7. Count them.
- Compare against the spec's listed testing expectations per ticket
- Grep for `.test.ts` files in the Wave 7 diff — 15 was claimed in the PR bodies (3 TAU + 5 UPSILON + 4 PHI + 3 Foundation). Verify count

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` — Testing section per phase
- Wave 5 testing review (baseline): `review/findings/testing.md`
