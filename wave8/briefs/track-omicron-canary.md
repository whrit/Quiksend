# TRACK OMICRON — Canary Signal Reliability + Tests

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave8-omicron-canary` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave8/WAVE_CONTEXT.md` — file ownership matrix
3. `phase11-review/CONSOLIDATED.md` — full review
4. `phase11-review/findings/correctness.md` § CORR-001, CORR-002, CORR-003, CORR-004, CORR-005, CORR-008
5. `phase11-review/findings/performance.md` § PERF-003, PERF-004
6. `phase11-review/findings/security.md` § SEC-P11-007
7. `phase11-review/findings/testing.md` § TEST-001, TEST-002, TEST-003
8. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Phase 11C
9. `apps/worker/src/deliverability/canary-send.ts`, `canary-check.ts`, `seed-imap.ts`
10. `apps/web/src/lib/canary-injection.ts`
11. `apps/worker/src/sequence/effects.ts` (`handleSendAuto` sanitizer pattern to mirror)

## Findings assigned (10 CRs)

### High (5)
- **CR-02** — Canary sends skip SEG content sanitizer; deliverability signal diverges from real
- **CR-03** — Bounce path never sets `arrival_status='bounced'`; spam mock mode missing; tests missing
- **CR-04** — IMAP canary poll scans full body of every message since 24h — not token-targeted
- **CR-05** — No cap on concurrent IMAP connections per poll cycle
- **CR-10** — `canary-check.test.ts` doesn't test the canary-check handler

### Medium (4)
- **CR-12** — Canary step selection ignores injected positions
- **CR-13** — `injectionStrategy` config accepted but not implemented
- **CR-14** — Canary sends bypass `send_reservation` throttle path
- **CR-30** — `classifyArrivalFolder` defaults unknown folder names to inbox

### Low (1)
- **CR-27** — Canary effect kinds `send_canary` + `emit_canary_bundle` orphaned in state machine (Option A: remove — coordinate with PHI2 who owns state machine cleanup)

## Documentation lookup (mandatory)
Context7 MCP for:
- **`imapflow` v1.4.3** — `search({ header })` syntax for header-based search; `fetch` streaming; connection pooling patterns
- **Drizzle ORM** — extending `canary_send` schema with `stepIndex` column, migration best practices

## Tasks

### T1 — Fix CR-02 (canary sanitizer parity)

`apps/worker/src/deliverability/canary-send.ts` — `materializeCanarySend()` currently
builds MIME and sends directly. Extend to:

1. Read workspace `contentSanitizerEnabled` policy from `organization.metadata.deliverability`
2. Read the seed inbox's `gateway` field to determine SEG status
3. Before `buildMime`, apply `sanitizeForSeg()` from `packages/mail/src/content-sanitizer` to the rendered body (matching `handleSendAuto` in `apps/worker/src/sequence/effects.ts:358-371`)
4. Verify signature: `sanitizeForSeg({ html, text }, { stripTrackingPixel, stripExternalImages, preferPlainText })` — check the existing `content-sanitizer.ts` for exact API

**Verification**: Add test `canary-send.test.ts` (or extend existing) mocking a
SEG seed inbox + workspace policy on; assert the rendered MIME's `html` field
has tracking pixel stripped when the equivalent real send would have.

### T2 — Fix CR-03 (bounce arrival path)

**Sub-task 2a**: `apps/worker/src/deliverability/seed-imap.ts`:
- Extend mock modes: `QUIKSEND_CANARY_IMAP_MOCK` accepts `inbox`, `spam`, `quarantine`, `not_found`, and NEW `bounce`
- Extend `extractCanaryToken()` to also match the UUID in `In-Reply-To`, `References`, and bounce body text (typical NDR: `Content-Type: multipart/report`, `Auto-Submitted: auto-replied`, `Return-Path: <>`)

**Sub-task 2b**: `apps/worker/src/handlers/canary-check.ts` `applyCanaryMatches`:
- When arrival matched by bounce heuristics → `arrival_status = 'bounced'`
- When matched normally by folder → existing logic

**Sub-task 2c**: Update `folderToStatus()` to map recognized bounce indicators.

### T3 — Fix CR-04 (header-targeted IMAP search)

`apps/worker/src/deliverability/seed-imap.ts` `searchCanaryMessages`:
1. Instead of `client.search({ since })` returning ALL UIDs, use header search: `client.search({ header: { 'X-Quiksend-Canary-Id': token }, since })`
2. If provider IMAP doesn't support header search (some do only via extension), fall back to search by subject suffix `[Q{shortToken}]` — the buildMime extension in PHI must know to add this suffix; coordinate with PHI2
3. Only `fetchOne(uid, { source: false, envelope: true, bodyStructure: false, headers: ['X-Quiksend-Canary-Id', 'In-Reply-To', 'References', 'Auto-Submitted', 'Return-Path'] })` for matching UIDs
4. Skip full-body download unless bounce classification is needed

**Verification**: Load-test-like unit test that seeds an IMAP mock with 100 messages, 3 canaries; assert `fetchOne` called at most 3 times.

### T4 — Fix CR-05 (IMAP semaphore)

`apps/worker/src/handlers/canary-check.ts` — wrap `pollSeed` in a semaphore:

```typescript
const IMAP_CONCURRENCY = 20; // matches spec
const semaphore = new Semaphore(IMAP_CONCURRENCY);
await Promise.all(seedIds.map(id => semaphore.acquire(() => pollSeed(id))));
```

If no semaphore utility exists in the repo, add one at `packages/core/src/utils/semaphore.ts` (pure, no I/O). Use the pattern from `packages/mail/src/gateway-detect.ts` DNS semaphore as reference.

### T5 — Fix CR-10 (real handler tests)

`apps/worker/src/handlers/canary-check.test.ts` — REPLACE the current stub with real handler tests:

- Import + call `runCanaryCheck` (or whatever the exposed entry point is)
- Seed via `withTestOrgs`: 2 orgs, each with a seed inbox + 5 pending canaries
- Mock `searchCanaryMessages` via `QUIKSEND_CANARY_IMAP_MOCK=inbox`
- Assert: `canary_send` rows for org A get `arrival_status='arrived_inbox'`
- Repeat with `spam` mock → `arrived_spam`
- Repeat with `bounce` mock (after T2) → `bounced`
- Fresh test with old `sent_at` (25h ago) + no mock arrival → assert `silent_drop` after sweep
- Assert `deliverability_snapshot` refresh runs (verify a snapshot row inserted)
- Assert `maybePauseCampaigns` fires when threshold breached (seed enough canaries)

Also add `seed-imap.test.ts` if it doesn't exist:
- Unit tests for `classifyArrivalFolder`, `extractCanaryToken`, `folderToStatus`
- Ensure CR-30 fix passes (unknown folder → returns `not_found`)

### T6 — Fix CR-12 (canary step selection uses hashToIndex, not injected position)

**Schema change**: Add `stepIndex: integer("step_index")` column to `canary_send` table in `packages/db/src/schema/deliverability.ts`. Migration `0019_wave8_omicron_canary_step_index.sql`.

**Code change**:
- `apps/web/src/lib/canary-injection.ts` `injectCanariesForEnrollment`: persist the chosen `stepIndex` on `canary_send` row insert.
- `apps/worker/src/deliverability/canary-send.ts` `materializeCanarySend`: read `canary_send.stepIndex` and use it instead of `hashToIndex(canaryToken, autoSteps.length)`. Fall back to hash if `stepIndex IS NULL` (backward compat).

### T7 — Fix CR-13 (`injectionStrategy` implementation)

`packages/core/src/deliverability/canary-config.ts` — extract position-picking to pure module.

`apps/web/src/lib/canary-injection.ts` — branch on `config.injectionStrategy`:
- `random_position` — current `pickRandomPositions` behavior
- `first_then_last` — pick position 0 and position N-1 (last auto-step)
- `every_nth` — pick every Nth position starting at 0

Unit tests in `packages/core/src/deliverability/canary-config.test.ts` for each strategy.

### T8 — Fix CR-14 (route canaries through `send_reservation`)

`apps/worker/src/deliverability/canary-send.ts` `materializeCanarySend`:
- Before `adapter.send`, call `reserveSendSlotInTx` (from `apps/worker/src/sequence/reserve-slot.ts`) with a synthetic reservation type. Do NOT count against real send caps (canaries are shadow sends), but DO enforce the SEG sub-cap + 5-min per-domain gap.
- Pattern: pass a distinct `reservationSource: 'canary'` flag if the API supports it; if not, use a separate `send_reservation` insert path that respects the same throttle rules.

Check the existing `reserveSendSlotInTx` signature. If it doesn't support a canary type today, coordinate the extension:
- Add optional `reservationSource: 'real' | 'canary'` (default `'real'`)
- Canary reservations DO check throttle + 5-min gap but DO NOT count against the daily cap

**Verification**: Test that canary sends respect the 5-min per-domain gap.

### T9 — Fix CR-27 partial: canary code cleanup on OMICRON side

Coordinate with PHI2 for state machine cleanup. YOUR side (OMICRON):
- Do NOT touch `packages/core/src/state-machine/{types,transition}.ts` — PHI2 owns
- Ensure your canary flow is 100% enrollment-time-enqueue based (no state machine effect production)
- Confirm `handleSendCanary` is dead by PHI2's time — you can delete `canary-send.ts` function references to `send_canary` effect handling if any exist

### T10 — Fix CR-30 (classifyArrivalFolder unknown → not_found)

`apps/worker/src/deliverability/seed-imap.ts:151-164`:
- Change the fallback from `return "inbox"` to `return "not_found"` for unrecognized folder names
- Optional: add per-provider folder maps (Microsoft "Clutter", "Other"; Gmail categories)

Test in `seed-imap.test.ts`.

## Files owned (strict)

- `apps/worker/src/deliverability/canary-send.ts` (all CRs)
- `apps/worker/src/deliverability/seed-imap.ts` (all CRs)
- `apps/worker/src/handlers/canary-check.ts` — main refactor; SIGMA will add 2 lines of fanout calls, leave section boundary comment
- `apps/worker/src/handlers/canary-check.test.ts` (REWRITE for CR-10)
- `apps/worker/src/deliverability/seed-imap.test.ts` (NEW)
- `apps/web/src/lib/canary-injection.ts` (CR-12, CR-13)
- `packages/core/src/deliverability/canary-config.ts` (extract position-picking logic)
- `packages/core/src/deliverability/canary-config.test.ts` (CR-13)
- `packages/db/src/schema/deliverability.ts` (add `stepIndex` column + relations if needed)
- `packages/db/drizzle/0019_wave8_omicron_canary_step_index.sql` (migration)
- `packages/core/src/utils/semaphore.ts` (NEW if not present)
- `packages/core/src/utils/semaphore.test.ts` (NEW)

## Do NOT touch

- `apps/worker/src/handlers/gateway-detect.ts` — RHO owns
- `apps/worker/src/handlers/deliverability-snapshot.ts` — RHO
- `packages/mail/src/gateway-detect.ts` — PHI2
- `packages/mail/src/content-sanitizer.ts` — PHI2 (CR-29); YOU import + call, don't modify
- `packages/core/src/state-machine/*` — PHI2 (CR-27)
- `apps/worker/src/sequence/effects.ts` — PHI2 removes `handleSendCanary`
- `apps/worker/src/sequence/reserve-slot.ts` — read only; if you need a new API signature, write NEEDS.md and use existing signature for now
- `packages/db/src/schema/api.ts` — SIGMA
- `apps/web/src/routes/**` — SIGMA (UI wiring)
- `docs/*.md` — SIGMA
- `internal-runbooks/*.md` — SIGMA (CR-26 in SIGMA)
- Provider seed pool handlers (`seed-pool-*.ts`) — PHI2 creates these

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
pnpm tsx scripts/load-test-engine.ts  # still passes
```

Manual smoke:
- Create workspace with content sanitizer enabled + Proofpoint-tagged prospects
- Enroll → canary sent → verify canary MIME has tracking pixel stripped (via Mailpit)
- Manually flip an IMAP mock to `bounce` → verify `arrival_status='bounced'` on canary row

## Result

```json
{
  "status": "ok",
  "track": "OMICRON",
  "findings_addressed": ["CR-02", "CR-03", "CR-04", "CR-05", "CR-10", "CR-12", "CR-13", "CR-14", "CR-27", "CR-30"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
