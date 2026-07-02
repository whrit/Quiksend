# TRACK OMEGA — Final Cleanup: Web Effect Executor + Perf + Test Polish

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave6-omega-cleanup` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave6/WAVE_CONTEXT.md`
3. `review/CONSOLIDATED.md`
4. `review/findings/architecture.md` § ARCH-002, ARCH-003
5. `review/findings/performance.md` § PERF-008, PERF-010, PERF-012
6. `review/findings/testing.md` § TEST-011 through TEST-017
7. `review/findings/completeness.md` § COMP-009, COMP-010
8. `packages/core/src/state-machine/transition.ts` — the source of truth for effects
9. `apps/worker/src/sequence/effects.ts` — the reference effect interpreter (canonical)

## Findings assigned (10 real items)

### HIGH — structural
- **ARCH-002 HIGH** — Web compose partial effect interpretation (`compose.functions.ts:338-399` handles only `capture_anchor` + `advance_step`, drops `schedule_at` and `emit_event`)
- **ARCH-003 HIGH** — Web `transitionEnrollment` in `sequences.functions.ts:836-865` applies `nextState` but drops `effects[]` (pause/resume/stop never emit `enrollment.paused` etc events)

### MED — perf polish
- **PERF-008 MED** — `sequence_stats` view exists but `getSequenceFunnel` recomputes raw aggregates
- **PERF-010 MED** — No timing instrumentation on analytics server-fns
- **PERF-012 MED** — `listInboxThreads` over-fetches 500 messages then groups in JS

### LOW/MED — completeness / testing polish
- **COMP-010 MED** — `captureManualAnchor` should be exposed as an `orgFn` server-fn (not a raw handler)
- **TEST-011 MED** — No end-to-end inbound bounce integration test
- **TEST-012 MED** — Extend HTTP API tenancy tests to cover more endpoints (currently only `prospects`)
- **TEST-015 LOW** — `packages/integrations/src/sync/upsert.test.ts` uses fixed org UUIDs (leaks state between test runs)
- **TEST-017 LOW** — Rename Nango webhook tests to make it clear they test the Nango inbound path, not Quiksend HMAC outbound (naming/comment fix)

## Documentation lookup (mandatory)
Context7 MCP for:
- **Drizzle ORM** — reading from a Postgres view vs base table, DISTINCT ON in query builder
- **Vitest** — snapshot testing, test hooks for HTTP-level assertions

## Tasks

### T1 — Fix ARCH-002 + ARCH-003 by extracting a shared web effect executor

Create `apps/web/src/lib/effect-executor.ts` — a thin, TX-aware interpreter that
applies `Effect[]` returned from `transition()`. It's the web-side counterpart of
`apps/worker/src/sequence/effects.ts` but limited to effects the web can emit:
- `capture_anchor` — set `enrollment.anchor_message_id/thread_id/next_run_at`
- `advance_step` — bump `current_step_index`
- `schedule_at` — set `next_run_at`
- `emit_event` — insert into `event` table (org-scoped `type`, `payload`)
- `terminate` — set terminal state

For `send_email`, `emit_slack_task`, etc. that only worker handles, throw
`WebOnlyEffectError` — the state machine will never emit them from a manual-send
or pause/resume/stop path but defensive.

Signature:
```ts
export async function applyWebEffects(
  tx: DrizzleTransaction,
  enrollmentId: string,
  organizationId: string,
  effects: Effect[],
): Promise<void>
```

Update:
- `compose.functions.ts` `sendComposedMessage` — replace its inline switch with a call to `applyWebEffects(tx, enrollmentId, organizationId, result.effects)`
- `sequences.functions.ts` `transitionEnrollment` — call `applyWebEffects` after
  `transition()` returns, before persisting `nextState`

Add unit test `apps/web/src/lib/effect-executor.test.ts` — cover each effect kind
against a mocked transaction (or real via `withTestOrgs`).

### T2 — Fix PERF-008 (route funnel to sequence_stats view)

`apps/web/src/lib/analytics.functions.ts:6-42` `getSequenceFunnel` recomputes counts.
Change to `SELECT * FROM sequence_stats WHERE organization_id = ? AND sequence_id = ?`
via Drizzle.

Verify the view returns identical shape. If any missing column, extend the view (in
`packages/db/src/schema/writeback.ts`) with a new migration `wave6_extend_sequence_stats`.
**Avoid** migrations if you can — restructure the read query instead.

### T3 — Fix PERF-010 (analytics timing instrumentation)

Wrap each `analytics.functions.ts` server-fn body in:
```ts
const start = performance.now();
try {
  return await work();
} finally {
  const durationMs = performance.now() - start;
  logger.info({ fn: "getSequenceFunnel", organizationId, durationMs }, "analytics timing");
  if (durationMs > 2000) {
    logger.warn({ fn, organizationId, durationMs }, "analytics slow query");
  }
}
```

Extract as a helper `withAnalyticsTiming(fnName, work)` in `analytics.functions.ts` or a
new `apps/web/src/lib/timing.ts`.

### T4 — Fix PERF-012 (inbox over-fetch)

`apps/web/src/lib/inbox.functions.ts:95-200` `listInboxThreads` loads 500 messages.
Rewrite to use SQL `DISTINCT ON (thread_key)` (or window function `ROW_NUMBER() OVER (PARTITION BY thread_key ORDER BY thread_at DESC)`) so only latest-per-thread returns.

Drizzle has `sql` template for raw fragments — use it for the DISTINCT ON. Verify
the result shape matches existing consumers.

Add regression test: seed 10 threads with 10 messages each (100 messages); assert
`listInboxThreads({ limit: 5 })` returns 5 threads (one per thread key), not 50 messages.

### T5 — Fix COMP-010 (captureManualAnchor as orgFn)

If `captureManualAnchor` currently lives as a plain function or a route handler,
wrap it as an `orgFn`-composed server-fn in `apps/web/src/lib/compose.functions.ts`
or a new `apps/web/src/lib/anchor.functions.ts`. Auth + org isolation is the point.

Grep first to see current shape:
```bash
grep -rn "captureManualAnchor" apps/ packages/
```

If already an `orgFn`, note in RESULT that this is a no-op.

### T6 — Fix TEST-011 (E2E inbound bounce)

`apps/worker/src/sequence/inbound-handler.test.ts` (or new). Seed:
- A `mailbox`, `sequence`, `prospect`, `enrollment` in `active` state
- Feed the handler a bounce inbound (either hard-bounce SMTP DSN or Gmail bounce payload)

Assert:
- `message.status = 'bounced'`, `message.bounce_type = 'hard'`
- `suppression` row inserted for the email
- `prospect.status = 'bounced'`
- `enrollment.state = 'stopped'` (or the state machine's terminal for bounce)

### T7 — Fix TEST-012 (extend HTTP API tenancy)

`apps/web/src/routes/api/v1/prospects.test.ts` covers one endpoint. Add:
- `apps/web/src/routes/api/v1/sequences.test.ts`
- `apps/web/src/routes/api/v1/enrollments.test.ts`

Both assert:
- API key for org A hits GET/POST for a resource in org B → 404
- API key for org A hits its own resource → 200

Follow the exact pattern from `prospects.test.ts`.

### T8 — Fix TEST-015 (fixed org ids in upsert.test.ts)

`packages/integrations/src/sync/upsert.test.ts` uses hardcoded UUIDs for `organizationId`.
Migrate to `withTestOrgs` helper from `packages/db/src/testing.ts` so each test run
uses fresh, unique org ids.

### T9 — Fix TEST-017 (rename Nango webhook tests)

Grep for tests that verify Nango webhook signature. Add a top-of-file comment block:
```ts
/**
 * These tests cover Nango's INBOUND webhook signature (Nango → us).
 * Outbound HMAC (us → subscriber endpoints) is tested in webhook-deliver.test.ts.
 */
```
And rename any misleadingly-named `describe` blocks.

## Files owned (strict)

- `apps/web/src/lib/effect-executor.ts` — NEW
- `apps/web/src/lib/effect-executor.test.ts` — NEW
- `apps/web/src/lib/compose.functions.ts`
- `apps/web/src/lib/sequences.functions.ts`
- `apps/web/src/lib/analytics.functions.ts`
- `apps/web/src/lib/inbox.functions.ts`
- `apps/web/src/lib/timing.ts` (optional, for PERF-010 helper)
- `apps/web/src/lib/anchor.functions.ts` (if COMP-010 needs new file)
- `apps/worker/src/sequence/inbound-handler.test.ts`
- `apps/web/src/routes/api/v1/sequences.test.ts` — NEW
- `apps/web/src/routes/api/v1/enrollments.test.ts` — NEW
- `packages/integrations/src/sync/upsert.test.ts`
- Any Nango webhook test files (rename comments only)

## Do NOT touch

- `packages/core/src/state-machine/**` — the state machine is stable; you consume its
  return values, don't extend `Effect` variants
- `apps/worker/src/sequence/**` — the reference executor. Read for reference only.
- Migrations — Wave 6 has no migrations
- `README.md`, `docs/**` — PSI owns

## Verification

```bash
pnpm install --frozen-lockfile
pnpm check                # green
pnpm tsx scripts/load-test-engine.ts --workspaces=2 --enrollments=20 --workers=2 --duration=30
# still passes end-to-end
```

Manual smoke:
- Pause an active enrollment via the UI → check `event` table has an
  `enrollment.paused` row (ARCH-003 fix proves it)
- Send a manual compose that triggers `schedule_at` on the state machine (edge case)
  → verify `next_run_at` gets set (ARCH-002 fix)

## Result

```json
{
  "status": "ok",
  "track": "OMEGA",
  "findings_addressed": ["ARCH-002", "ARCH-003", "PERF-008", "PERF-010", "PERF-012", "COMP-010", "TEST-011", "TEST-012", "TEST-015", "TEST-017"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
