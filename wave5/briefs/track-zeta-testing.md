# TRACK ZETA — Testing Coverage + Tenancy Expansion + CI Load-Test

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave5-zeta-testing` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md` + `WAVE_CONTEXT.md` (root) + `wave5/WAVE_CONTEXT.md`
2. `review/CONSOLIDATED.md`
3. `review/findings/testing.md` — full detail
4. `apps/web/src/lib/prospect-tenancy.test.ts` — the pattern to follow
5. `packages/db/src/testing.ts` — `withTestOrgs` helper
6. `packages/db/src/tenancy-guard.test.ts` — the regex CI guard
7. `scripts/load-test-engine.ts` — the auth load test

## Findings assigned (all TEST-* + ARCH-007 + ARCH-009)

Testing review flagged 8 HIGH + 9 MED. Full list:

### HIGH (missing coverage of P1 invariants)
- **TEST-01** — No test for idempotency skip path (`effects.ts:248-268` retry-with-same-key branch)
- **TEST-02** — No test for `captureManualAnchor` DB round-trip (state-machine effect emission is tested; persistence path is not)
- **TEST-03** — No test for CRM writeback replay dedupe (`crm-writeback.ts:224-231`)
- **TEST-04** — No test for Quiksend HMAC webhook sign/verify (only Nango inbound tested)
- **TEST-05** — No test for API key org scoping (no HTTP-level test with real key)
- **TEST-06** — Tenancy tests for 9 entities missing:
  - sequences
  - mailboxes
  - crm connections
  - messages
  - enrollments
  - value_prop
  - research_profile
  - webhooks (webhook_endpoint + webhook_delivery)
  - api keys (apikey via better auth)
- **TEST-07** — `apikey` not in `APP_SCOPED_TABLES_TO_TRUNCATE` — cross-test leakage risk
- **TEST-08** — Load tests never run in CI

### MED
- Various weak assertions, `expect(x).toBe(true)` etc — pick your battles; the review
  lists them in `review/findings/testing.md` § Test Quality
- **ARCH-007** — `APP_SCOPED_TABLES` (tenancy guard) missing `jobLog`, `sendReservation`, `listMember`, `importError`
- **ARCH-009** — Adapter unit tests mock providers rather than using `createFakeAdapter` — document
- P2 items in the review

## Documentation lookup (mandatory)
Context7 MCP for:
- **Vitest** — `test.concurrent`, `describe.each`, `beforeEach` DB truncation patterns
- **Better Auth** — how to create an apiKey in tests + how to hit `resolveApiKey` from a test HTTP request

## Tasks

### T1 — Test infrastructure hardening

- Add `apikey` to `packages/db/src/testing.ts` `APP_SCOPED_TABLES_TO_TRUNCATE`.
- Extend `packages/db/src/tenancy-guard.test.ts` `APP_SCOPED_TABLES`:
  add `jobLog`, `sendReservation`, `listMember`, `importError`.
- Verify the CI guard still passes on main (no false positives).

### T2 — Regression tests for the 5 P1 gaps

#### TEST-01 — Idempotency skip path
`apps/worker/src/sequence/idempotency.test.ts` — new. Setup: an enrollment with a
message already at `status='sent'` with a specific `idempotency_key`. Invoke a mock
executor that would send again. Assert `adapter.send` is NOT called AND the state
machine advances as if the send succeeded.

Use a mock `MailboxAdapter` from `createFakeAdapter`.

#### TEST-02 — captureManualAnchor DB round-trip
`apps/worker/src/sequence/anchor.test.ts` — new. Setup: an enrollment in
`waiting_manual` state + a real Message-Id. Call `captureManualAnchor({ enrollmentId,
messageId, threadId, providerMessageId, sentAt })`. Assert:
- `enrollment.anchor_message_id` = normalized Message-Id
- `enrollment.anchor_thread_id` = threadId
- `enrollment.state` = `active`
- `enrollment.next_run_at` = computed correctly for step 1 from sentAt

Use `withTestOrgs`. Real DB.

#### TEST-03 — CRM writeback replay dedupe
`apps/worker/src/handlers/crm-writeback.test.ts` — new. Setup: a `crm_writeback_log`
row with `status='succeeded'`. Invoke the handler with the same idempotency_key.
Assert:
- No new `crm_writeback_log` row inserted
- Mock CRM (Nango) NOT called
- Handler returns cleanly

#### TEST-04 — Quiksend outbound HMAC round-trip
`apps/worker/src/handlers/webhook-deliver.test.ts` — new. Test `signWebhookPayload`
+ `verifyWebhookSignature` round-trip. Verify tampered payload rejects. Verify
timestamp outside 300s rejects. Verify (after GAMMA lands SEC-005) that including
`deliveryId` in signature matches the current implementation.

Wait — GAMMA is changing this file for SEC-005. Since your test asserts current behavior,
coordinate. Best plan: write the test AGAINST the intended behavior (with deliveryId
in signature). If GAMMA hasn't shipped yet, your test fails; that's a signal for
GAMMA to complete SEC-005. Coordinate merge order.

#### TEST-05 — API key org scoping
`apps/web/src/routes/api/v1/prospects.test.ts` — new. Setup: create two orgs A and B
via `withTestOrgs`. Create an API key for org A. Create a prospect in org B. Make a
GET request to `/api/v1/prospects/{orgB-prospect-id}` with the org A key. Assert
`404`, not `200` or `500`.

Use vitest with a mocked TanStack Start request/response, or run the app against a
test port and hit it with fetch. Simpler: mock at the handler level — `withApiAuth`
middleware returns the resolved orgId; call the route's handler directly.

### T3 — Tenancy tests for 9 missing entities (TEST-06)

Follow the exact pattern from `apps/web/src/lib/prospect-tenancy.test.ts`:
```ts
describe("<entity> tenancy", () => {
  it("org B cannot read org A <entity>", ...);
  it("org B cannot update org A <entity>", ...);
  it("org B cannot delete org A <entity>", ...);
  it("two orgs can each have <entity> with same natural key", ...);
});
```

One file per entity:
- `apps/web/src/lib/sequences-tenancy.test.ts`
- `apps/web/src/lib/mailboxes-tenancy.test.ts`
- `apps/web/src/lib/crm-tenancy.test.ts`
- `apps/web/src/lib/messages-tenancy.test.ts`
- `apps/web/src/lib/enrollments-tenancy.test.ts`
- `apps/web/src/lib/value-props-tenancy.test.ts` (value_prop + research_profile in one file OK)
- `apps/web/src/lib/webhooks-tenancy.test.ts`
- `apps/web/src/lib/api-keys-tenancy.test.ts`

Some entities (research_profile) have no update UI; skip that case for those. Focus
on read/delete/create isolation.

### T4 — Load test in CI (TEST-08)

Add a job to `.github/workflows/ci.yml` OR a new workflow that runs
`pnpm tsx scripts/load-test-engine.ts --workspaces=2 --enrollments=20 --workers=2 --duration=30`
after migration. Gate on the same conditions as the main check. It's ~30-60 seconds
of runtime — acceptable for main+PR CI.

If runtime concern: run only on `main` push, not on every PR. Document in PR the
choice.

### T5 — Schema-parse retry test (P2)

`packages/ai/src/generation/generate-email.test.ts` — new. Mock the model provider to
return an invalid schema on first call, valid on second. Assert:
- `generateEmail` retries
- Total invocations = 2
- Final result matches schema

### T6 — Adapter fake vs mock documentation (ARCH-009)

Add a comment block at the top of `packages/mail/src/adapters/gmail.test.ts` +
`microsoft.test.ts` + `smtp.test.ts` explaining WHY these use provider mocks vs
`createFakeAdapter`. If it's justified (they're testing adapter internals, not
engine behavior), document that. If it's not, migrate them.

### T7 — Weak assertion sweep (P2)

Grep for `expect(x).toBe(true)` in test files. For each occurrence, evaluate: is
this a boolean-return check (fine) or a structural placeholder (fix to assert
structure)? Fix any structural ones.

## Files owned (strict)

- `apps/web/src/lib/*-tenancy.test.ts` — all new tenancy tests
- `apps/worker/src/sequence/{idempotency,anchor}.test.ts` — new
- `apps/worker/src/handlers/{crm-writeback,webhook-deliver}.test.ts` — new
- `apps/web/src/routes/api/v1/prospects.test.ts` — new for API key scoping
- `packages/ai/src/generation/generate-email.test.ts` — new
- `packages/db/src/testing.ts` — add `apikey` to truncate list
- `packages/db/src/tenancy-guard.test.ts` — add 4 missing tables
- `.github/workflows/ci.yml` OR new `.github/workflows/load-test.yml`
- Comment additions on `packages/mail/src/adapters/{gmail,microsoft,smtp}.test.ts`

## Do NOT touch

- Any implementation file — you write tests against current + intended behavior only
- Migrations — EPSILON
- Server-fns — DELTA + BETA + GAMMA + ALPHA

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check
```

All new tests pass. Existing tests continue passing.

If a test you write fails because the implementation isn't yet correct (e.g. TEST-04
webhook signing without deliveryId — GAMMA hasn't landed), mark it `.skip` with a
TODO referencing the finding + track. Consolidation will un-skip after GAMMA merges.

Prefer: write it correctly, expect green after GAMMA. Ship the test, note the
dependency in RESULT.

## Result

```json
{
  "status": "ok",
  "track": "ZETA",
  "findings_addressed": ["TEST-01", "TEST-02", "TEST-03", "TEST-04", "TEST-05", "TEST-06", "TEST-07", "TEST-08", "ARCH-007", "ARCH-009", "+ P2 items"],
  "tests_added": [...list all new test files...],
  "notes": "TEST-04 asserts GAMMA's SEC-005 change (deliveryId in signature); test currently .skip if GAMMA hasn't merged. Coordinate merge order."
}
```
