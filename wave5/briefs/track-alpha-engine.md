# TRACK ALPHA — Engine Safety + CAN-SPAM Compliance + Effect Executor Refactor

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave5-alpha-engine` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (root) — Wave 1 conventions
3. `wave5/WAVE_CONTEXT.md` — this fix wave
4. `review/CONSOLIDATED.md` — the review verdict
5. `review/findings/correctness.md` — full detail on the engine bugs
6. `review/findings/security.md` § SEC-001
7. `packages/core/src/state-machine/transition.ts` + `transition.test.ts`
8. `apps/worker/src/sequence/*` — every file, know the whole path

## Findings assigned (9)

- **CR-001 CRITICAL** — Suppression table ignored on every send path
- **CR-002 CRITICAL** — Engine dead-letter path unreachable
- **CR-003 CRITICAL** — `next_run_at` cleared before step succeeds
- **CR-004 HIGH** — Auto-email uses placeholder unsubscribe URL + postal address
- **CR-005 HIGH** — Reservation + SMTP + `markReservationSent` not atomic
- **CR-010 HIGH** — State machine `effects[]` dropped by 3 non-executor paths (executor extraction — part 1 lives here; parts 2 and 3 live in the web app and are handled by Track BETA + DELTA)
- **BUG-006 MEDIUM** — Compose mailbox not validated to match enrollment mailbox
- **PERF-002 MEDIUM** — Batch size 100 + 30s tick caps drain at ~3.3/sec
- **PERF-003 MEDIUM** — Per-row UPDATE inside claim transaction

## Documentation lookup (mandatory)
Context7 MCP for:
- **pg-boss v12** — how to read `retryCount` / job metadata inside handlers; `deadLetter` config
- **Drizzle ORM** — `sql\`\`` raw templates, transactions, savepoints
- **PostgreSQL** — `SELECT ... FOR UPDATE SKIP LOCKED` semantics + advisory locks
- **postgres.js** — nested transactions / savepoints API

## Tasks

### T1 — Fix CR-002 + CR-003 (engine dead-letter reachability + next_run_at safety)

**Root cause**: `execute-step.ts:68-76` reads `payload.attempt` which is always 0 from
tick.ts:24. Fix by using pg-boss's `retryCount` from the job metadata OR by tracking
attempts on the `enrollment` row directly.

Choose the cleanest path:

**Option A (preferred)**: pg-boss job handler receives job metadata that includes
`retryCount`. Verify via Context7 MCP that the handler signature in `apps/worker/src/sequence/register.ts`
can access it. Read attempt from `retryCount`, not payload.

**Option B**: Increment `enrollment.attempt_count` (already exists per Phase 5) inside
the transaction that persists any step failure. Read from `enrollment` on entry.

Either way:
- `handleStepFailure` MUST fire at max attempts
- When it fires, emit a `step_failed` event to the state machine → transition to
  `failed` at max attempts → insert `job_log` row `status='dead'` → capture Sentry
  exception
- On TRANSIENT failure (attempt < max), reschedule `next_run_at = now() + backoff(attempt)`
  and leave state at `active`
- On PERMANENT failure (adapter returned SendError kind=`permanent` or `auth`), skip
  retries — go straight to `failed`

For CR-003: don't null `next_run_at` in the claim transaction if the retry policy is
going to re-run this enrollment. Options:
1. Set `next_run_at` to a "processing sentinel" (e.g. `now() + 15min`) instead of NULL,
   so a stuck job eventually reappears.
2. Rewrite dead-letter to explicitly reset `next_run_at` after terminating.
3. Add a background sweep job (`sequence.sweep`) that finds `active` enrollments with
   `next_run_at IS NULL AND updated_at < now() - interval '15 minutes'` and re-schedules.

Pick (1) — simplest and self-healing. Document the choice inline.

### T2 — Fix CR-001 (suppression table pre-check)

**Root cause**: `apps/worker/src/sequence/guards.ts:7-9` checks `prospect.status` only.
The `suppression` table is never queried before an outbound send.

- `guards.ts` `isSuppressed(ctx)` MUST query `suppression WHERE organization_id = ? AND value = ? AND (value_type = 'email' OR (value_type = 'domain' AND value = domainOf(email)))`.
  Return true if ANY row matches.
- Also update `apps/web/src/lib/inbox.functions.ts` `suppressEmail` to ALSO write
  `prospect.status = 'unsubscribed'` (or `'do_not_contact'` for manual) in the same
  transaction. That way both checks converge.
- Update `apps/worker/src/sequence/inbound-handler.ts:71-82` to also set
  `prospect.status = 'bounced'` when inserting a `suppression` row from a hard bounce.
- Update `apps/web/src/routes/api/v1/unsubscribe.ts` (Phase 10) to ALSO update
  `prospect.status = 'unsubscribed'` in the same transaction that inserts the
  suppression row. (Trace the file; if the update already exists, verify + note.)
- Enrollment creation server-fn (`apps/web/src/lib/sequences.functions.ts` `enrollProspects`)
  MUST skip prospects that are suppressed (query suppression table, skip matching emails).
  Return them in the `skipped` array with reason.

Add unit tests:
- `apps/worker/src/sequence/guards.test.ts` — new file. Cover: prospect status = active but
  suppression row exists → true. Prospect status = new + no suppression → false. Domain
  suppression matches email at the domain → true.

### T3 — Fix CR-004 (real unsubscribe URL + postal address in auto-send)

**Root cause**: `apps/worker/src/sequence/effects.ts:287-291` uses hardcoded
`https://app.example.com/u/pending` and placeholder postal address.

- Mint a real unsubscribe token via `mintUnsubscribeToken({ prospectId, orgId })` from
  `packages/mail/src/unsubscribe.ts` (Phase 10 shipped it).
- Postal address: read from the workspace's `organization.metadata` jsonb column. Add
  a helper `getWorkspacePostalAddress(orgId)` that reads it. If not set, fall back to
  a documented default and log a warning (deliverability risk). Track BETA will add a
  settings UI to configure this; you produce the read-side helper.
- Update BOTH `handleSendAuto` in `effects.ts` AND `handleAutoInboxReply` (if such a
  path exists) to use the real values.

Regression test: extend or add a test that asserts the built MIME has:
- `List-Unsubscribe` header containing a valid signed token URL that `verifyUnsubscribeToken` accepts
- A non-placeholder postal address in the footer

### T4 — Fix CR-005 (reservation atomicity)

**Root cause**: `reserveSendSlot` opens its own transaction (commits `held`), then
`adapter.send()` runs outside any transaction, then `markReservationSent` uses global
`db` handle (autocommits). If the outer executor TX rolls back after SMTP succeeded,
the reservation stays `held` (autocommitted) → cap leak; the message row is undone →
retry finds no idempotency record → double-send.

Fix by picking one:

**Option A (preferred)**: Restructure the send flow so the ENTIRE unit is in one
transaction:
1. Start outer TX.
2. `pg_advisory_xact_lock(mailboxId)`.
3. Check window/throttle/cap.
4. INSERT `send_reservation` status='held'.
5. INSERT `message` row status='sending' with idempotency_key.
6. Call `adapter.send()` inside the tx (external I/O but before commit — long TX risk).
7. UPDATE `send_reservation` status='sent'.
8. UPDATE `message` status='sent', populate provider_message_id + sent_at.
9. Commit.

**Option B (better for long external I/O)**: Two-phase:
1. Outer TX: reservation held + message row status='sending' + idempotency_key. Commit.
2. Adapter.send() (external I/O, no TX).
3. On success: UPDATE message + reservation atomically in ONE tx.
4. On failure: UPDATE reservation status='released' + message status='failed'.
5. On process crash between (2) and (3): retry finds `message status='sending'` and
   provider-side check (Gmail returns 200 = already sent → treat as sent; else send
   again).

Option A has adapter.send() inside a DB TX which risks pool exhaustion under load. But
it's the simplest correctness. Since we're V0-level scale, ship Option A first and
migrate to Option B later.

Update the load test: add a scenario `--force-outer-rollback=1` that injects a
rollback after adapter.send() returns success. Assert no `message` rows are duplicated
across retries. This proves CR-005 is fixed.

### T5 — Fix CR-010 (effect executor bypasses in worker)

**Root cause**: `apps/worker/src/sequence/execute-step.ts:27-56` synthesizes `terminate`
effects for suppression + reply pre-checks, bypassing `transition({ kind: "reply_received" })`.

Fix: emit proper events instead of synthesizing effects.
- Suppression → new `Event` variant `{ kind: "suppressed", at: Date }` in
  `packages/core/src/state-machine/types.ts`. Transition returns `nextState: "stopped"` + `terminate + emit_event`.
- Reply pre-check → use existing `reply_received` event; transition handles it.

Add to `transition.ts` and `transition.test.ts`.

### T6 — Fix BUG-006 (compose mailbox mismatch)

**Location**: `apps/web/src/lib/compose.functions.ts:111-212`, `apps/worker/src/sequence/load-context.ts:47-53`

When `sendComposedMessage` is called with an enrollmentId, validate
`data.mailboxId === enrollment.mailboxId`. If mismatch, throw a clear error. This
enforces the manual-first invariant that the follow-up thread continues on the same
mailbox as the anchor.

### T7 — Fix PERF-002 + PERF-003 (scheduler throughput)

- PERF-002: raise LIMIT dynamically OR run tick more frequently when queue depth is
  high. Simplest: change tick to `*/10 * * * * *` (every 10s) and keep LIMIT at 100.
  Document trade-off. Or better: `while (claimed === 100) { claim more }` until empty
  or a budget of 1000/tick.
- PERF-003: batch UPDATE using `UPDATE enrollment SET next_run_at = ... WHERE id = ANY($1)`
  instead of a per-row loop.

### T8 — Extend load test

`scripts/load-test-engine.ts` must cover the fixed failure modes:
- Add `--test-mode=permanent-failure`: run with a fake adapter that permanently fails
  N sends. Assert those enrollments reach `state='failed'` + `job_log` `status='dead'` rows exist.
- Add `--test-mode=outer-rollback`: fake adapter succeeds but the executor is forced
  to rollback after send. Assert no double-send on retry.
- Add `--test-mode=suppression-during-run`: mid-run, insert a `suppression` row for
  one enrollment's prospect. Assert that enrollment's next send is skipped.

Keep the existing `--test-mode=happy-path` (default). Load test still runs in
< 60s on `pnpm tsx`.

## Files owned (strict)

- `apps/worker/src/sequence/**` — ALL files
- `apps/worker/src/handlers/sequence-*.ts` — if any
- `packages/core/src/state-machine/**`
- `apps/web/src/lib/compose.functions.ts` (for BUG-006 validation)
- `apps/web/src/lib/sequences.functions.ts` (for enrollment suppression skip only —
  do NOT touch pause/resume/stop; DELTA owns that fix under ARCH-004/010)
- `apps/web/src/lib/inbox.functions.ts` (for `suppressEmail` → also update prospect.status)
- `apps/web/src/routes/api/v1/unsubscribe.ts` (for prospect.status update alongside suppression insert)
- `apps/worker/src/sequence/inbound-handler.ts` (for suppression row insert on bounce also sets prospect.status)
- `scripts/load-test-engine.ts`
- `packages/mail/src/unsubscribe.ts` — read only; you IMPORT `mintUnsubscribeToken`

## Do NOT touch

- `packages/mail/**` except `unsubscribe.ts` (read only) — DELTA owns mail decoupling
- `packages/ai/**` — DELTA
- `packages/db/src/schema/**` — EPSILON owns index additions; if you must add columns
  (e.g. `enrollment.last_attempted_at`), coordinate with EPSILON via NEEDS.md
- Public API `/api/v1/*` — DELTA
- Prospect UI/routes — BETA
- Test files unrelated to engine — ZETA

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate                      # main baseline
pnpm check                           # green
pnpm tsx scripts/load-test-engine.ts # all invariants + your new test modes pass
```

Extra: manually run a compose that includes an enrollment id but mismatched mailbox;
verify the error message. Manually insert a `suppression` row for an enrolled prospect;
run the tick; verify no send. Add a fake permanent-failure to load test; verify
`failed` state + `job_log`.

## Result

```json
{
  "status": "ok",
  "track": "ALPHA",
  "findings_addressed": ["CR-001", "CR-002", "CR-003", "CR-004", "CR-005", "CR-010", "BUG-006", "PERF-002", "PERF-003"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "Engine dead-letter reachable via <choice>. Suppression pre-check + prospect.status sync. Real unsubscribe minter in auto-send. Reservation atomicity via <Option A|B>. Effect executor centralized. Load test covers permanent-failure + outer-rollback + suppression-mid-run."
}
```
