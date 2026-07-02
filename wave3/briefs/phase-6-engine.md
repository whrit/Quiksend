# PHASE-6: Scheduler + step executor + reserveSendSlot + idempotency — Track G

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-6-engine` from `main` (worktree isolated).

## Context (read in order)

1. `CLAUDE.md`
2. All `WAVE_CONTEXT.md` (root + wave3)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` — section
   **"Phase 6 — Scheduler & engine (the core)"** — the hardest phase.
4. `packages/core/src/state-machine/transition.ts` — the pure state machine
   (foundations landed it, exhaustively tested). YOU ARE THE INTERPRETER.
5. `packages/core/src/schedule/compute-schedule.ts` — the pure schedule math.
6. `packages/mail/src/adapter.ts` — `MailboxAdapter` contract.
7. `packages/queue/src/{boss,jobs}.ts` — pg-boss wrapper + typed job registry
   (`sequence.tick` + `sequence.step` job types already registered).

**This is the highest-risk phase of the whole plan.** Correctness bugs here cause
duplicate sends, cap breaches, or lost enrollments. Treat every branch as
adversarial and test exhaustively.

## Documentation lookup (mandatory)

Context7 MCP for:

- **Drizzle ORM** — raw `sql\`\``template usage (ORM query builder does NOT emit`FOR UPDATE SKIP LOCKED`; you MUST use raw SQL for the claim query)
- **pg-boss v12** — `schedule("job", cron, data, options)` for the periodic tick,
  `send()` with `startAfter`/`retryLimit`/`retryBackoff` options, `singletonKey`
  for idempotency at the queue level too
- **PostgreSQL** — advisory locks (`pg_advisory_xact_lock`), `SKIP LOCKED`
  semantics, transaction isolation levels

## Tasks (in order — each must land + test cleanly before the next)

### T1 — New tables (`packages/db/src/schema/tasks.ts`)

- **`task`** — id (uuid pk), organization_id (text FK cascade),
  enrollment_id (uuid FK cascade), step_id (uuid FK → sequence_step.id set null),
  type pg enum ('compose', 'generic') notNull,
  title text notNull, instructions text nullable,
  due_at timestamptz nullable, status text default 'open' ('open' | 'in_progress' | 'done' | 'skipped'),
  assigned_user_id text FK nullable,
  completed_at timestamptz nullable,
  timestamps.
  Index `(organization_id, status, due_at)`.

- **`send_reservation`** — the atomic slot reservation.
  id (bigserial), mailbox_id (uuid FK cascade), enrollment_id (uuid FK cascade),
  reserved_at timestamptz default now notNull,
  window_start timestamptz notNull (rounded start of the 24h cap window),
  status pg enum ('held', 'sent', 'released') default 'held' notNull.
  Index `(mailbox_id, window_start)` — cap counting.

- **`job_log`** — id (bigserial), job_name text notNull,
  payload_ref text (a `(enrollment_id, step_id, attempt)` composite),
  status pg enum ('started', 'succeeded', 'failed', 'dead') notNull,
  attempt int notNull, error text nullable, duration_ms int nullable,
  created_at timestamptz default now notNull.
  Index `(payload_ref, created_at DESC)` for debugging.

Extend `enrollment` schema (Phase 5 pre-baked most fields — you WRITE them):

- No schema changes needed. `anchor_message_id`, `anchor_thread_id`,
  `attempt_count`, `last_error`, `idempotency_key` are already there.

Extend `message` schema:

- Add `idempotency_key text unique` — used by `recordOutbound` to prevent double-writes.

Barrel + tenancy guard + testing.ts.

### T2 — Migration

`pnpm db:generate --name phase6_tasks_reservations` → review → `pnpm db:migrate`.

### T3 — Scheduler tick (`apps/worker/src/sequence/tick.ts`)

Runs every 30s via pg-boss cron. Claims due enrollments with SKIP LOCKED:

```ts
import { sql } from "drizzle-orm";
import { db } from "@quiksend/db";
import { enqueue } from "@quiksend/queue";

export async function tick(): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM enrollment
      WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);
    for (const row of rows.rows) {
      // Null the next_run_at atomically so re-claims don't pick this up.
      await tx.execute(
        sql`UPDATE enrollment SET next_run_at = NULL WHERE id = ${row.id}`,
      );
      await enqueue("sequence.step", { enrollmentId: row.id, attempt: 0 });
    }
  });
}
```

Register via pg-boss schedule in `apps/worker/src/index.ts`:

```ts
await boss.schedule("sequence.tick", "*/30 * * * * *", {}, { tz: "UTC" });
await registerHandler("sequence.tick", tick);
```

### T4 — Step executor (`apps/worker/src/sequence/execute-step.ts`)

Handles `sequence.step` jobs. Load enrollment + current step + mailbox → build
snapshot → call `transition({ kind: "tick" })` from `@quiksend/core` → interpret
effects.

**Structure:**

```ts
export async function executeStep({ enrollmentId, attempt }): Promise<void> {
  const ctx = await loadContext(enrollmentId); // enrollment + sequence + step + mailbox + prospect + prior messages
  const snapshot = toSnapshot(ctx);
  const { nextState, effects } = transition(snapshot, {
    kind: "tick",
    at: new Date(),
  });

  // Defense in depth: check terminal guards BEFORE effects
  if (await isSuppressed(ctx.orgId, ctx.prospect.email)) {
    return terminate(ctx, "unsubscribed");
  }
  if (ctx.stopOnReply && (await hasReplyOnThread(ctx))) {
    return terminate(ctx, "replied");
  }

  await db.transaction(async (tx) => {
    for (const effect of effects) {
      switch (effect.kind) {
        case "send_auto":
          await handleSendAuto(tx, ctx, effect, attempt);
          break;
        case "create_compose_task":
          await createComposeTask(tx, ctx, effect);
          break;
        case "create_task":
          await createTask(tx, ctx, effect);
          break;
        case "advance_step":
          await advanceStep(tx, ctx);
          break;
        case "capture_anchor":
          /* handled in on-send path */ break;
        case "emit_event":
          await emitEvent(tx, ctx, effect.type);
          break;
        case "terminate":
          await terminateInTx(tx, ctx, effect.reason);
          break;
        case "increment_attempt":
          await incrementAttempt(tx, ctx);
          break;
        case "schedule_at":
          await scheduleAt(tx, ctx, effect.at);
          break;
      }
    }
    if (nextState !== ctx.enrollment.state) {
      await tx
        .update(enrollment)
        .set({ state: nextState })
        .where(eq(enrollment.id, ctx.enrollmentId));
    }
  });
}
```

Register `sequence.step` handler with retries:

```ts
await registerHandler("sequence.step", executeStep);
// pg-boss retry: 5 attempts, exponential backoff (60s, 5m, 30m, 3h, 12h)
```

### T5 — `reserveSendSlot` (`apps/worker/src/sequence/reserve-slot.ts`)

The atomic slot reservation. Options analyzed:

**Option A (advisory lock + count):** Take `pg_advisory_xact_lock(mailbox_id_hash)`
in the transaction that inserts the `send_reservation`, then count rows in the
rolling 24h window and check < daily_cap. Simplest to reason about.

**Option B (partial unique index):** Model each cap slot as a row with a
`slot_index int` (0..dailyCap-1); unique on `(mailbox_id, window_start, slot_index)`.
Insert the first-free slot; conflict = cap breach → defer.

**Choose A** — simpler, no schema gymnastics, unit-testable under contention.
Advisory locks are per-session so use `pg_advisory_xact_lock` (transaction-scoped).

```ts
export async function reserveSendSlot(
  mailboxId: string,
  enrollmentId: string,
  at: Date,
): Promise<
  { ok: true; reservationId: number } | { ok: false; deferUntil: Date }
> {
  return db.transaction(async (tx) => {
    // Serialize per-mailbox
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mailboxId}))`);
    const mailbox = await loadMailbox(tx, mailboxId);
    // 1. Sending window
    if (!isInsideWindow(at, mailbox)) {
      const nextOpen = nextOpenSlot(at, mailbox, /*businessDaysOnly*/ true);
      return { ok: false, deferUntil: nextOpen };
    }
    // 2. Throttle (min gap since last send on this mailbox)
    const lastSend = await lastSendAt(tx, mailboxId);
    if (
      lastSend &&
      (at.getTime() - lastSend.getTime()) / 1000 < mailbox.throttle_seconds
    ) {
      return {
        ok: false,
        deferUntil: new Date(
          lastSend.getTime() + mailbox.throttle_seconds * 1000,
        ),
      };
    }
    // 3. Daily cap (rolling 24h)
    const usedInWindow = await countReservationsInWindow(tx, mailboxId, at);
    if (usedInWindow >= mailbox.daily_cap) {
      const oldestInWindow = await oldestReservationTime(tx, mailboxId, at);
      const deferUntil = new Date(
        oldestInWindow.getTime() + 24 * 60 * 60 * 1000,
      );
      return { ok: false, deferUntil };
    }
    // Reserve
    const [row] = await tx
      .insert(sendReservation)
      .values({
        mailboxId,
        enrollmentId,
        windowStart: startOfWindow(at),
        status: "held",
      })
      .returning({ id: sendReservation.id });
    return { ok: true, reservationId: row.id };
  });
}
```

On successful send → `UPDATE send_reservation SET status='sent'`. On failure →
`status='released'` so a future retry can grab a new slot.

### T6 — Idempotency + retries + dead-letter

- Every send writes a `message` row with `idempotency_key =
hashHex(SHA-256(enrollmentId + '|' + stepId + '|' + attempt))`.
- Before invoking the adapter: `SELECT * FROM message WHERE idempotency_key = $1`.
  If found and `status='sent'` → no-op, treat as success (retry replaying a
  successful send).
- pg-boss retry with backoff (T4). After max attempts → mark enrollment `failed`
  via `step_failed` event + insert `job_log` with status `dead` + Sentry
  `captureException`.

### T7 — Manual-first anchor capture (`apps/worker/src/sequence/anchor.ts`)

Server-fn callable from web app (Track B's compose UI at Phase 4). When the
user sends a manual email through the compose UI:

```ts
export async function captureManualAnchor({
  enrollmentId,
  messageId,
  threadId,
  providerMessageId,
  sentAt,
}): Promise<void>;
```

Loads snapshot → calls `transition(snapshot, { kind: "manual_sent", anchorMessageId,
anchorThreadId, at })` → interprets effects (capture_anchor + advance_step +
emit_event) in a tx.

Also: the "start follow-up from existing email" flow. Server fn
`enrollWithExistingAnchor({ prospectId, sequenceId, existingMessageId })` — loads
the outbound message row, copies its provider ids to the new enrollment as the
anchor, sets `current_step_index = 0`, computes `next_run_at` from the anchor's
`sent_at + step[0].delay_minutes`.

### T8 — Load test (`scripts/load-test-engine.ts`)

Seeds N workspaces × M enrollments × K steps. Runs 2 `apps/worker` processes
concurrently for 5 min. Asserts:

- No message row has duplicate `idempotency_key`
- No mailbox exceeds `daily_cap` in any rolling 24h window
- All enrollments either terminal or with valid `next_run_at`
- No `job_log` in status='dead' unexpectedly

This is the proof the engine holds under contention. Include a fake adapter
that always succeeds so we're testing the ENGINE not the network.

### T9 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase6_tasks_reservations
pnpm db:migrate
pnpm check   # green, zero tolerance

# Load test
pnpm tsx scripts/load-test-engine.ts --workspaces=3 --enrollments=100 --workers=2 --duration=120
# Expected: "OK" — no double-sends, no cap breaches, no crashes.
```

Manual smoke:

- Create a sequence with manual_email → wait 5m → auto_email × 2.
- Enroll a prospect.
- Compose the manual — verify enrollment moves waiting_manual → active with
  anchor captured.
- Wait 5m (or `UPDATE enrollment SET next_run_at = now()` to force).
- Verify auto_email lands in Mailpit as a proper Re: threaded reply under the
  anchor.
- Cap check: set daily_cap=2, enroll 5 prospects, verify 3 defer.
- Pause/resume/stop cycle works.
- Kill and restart worker mid-batch → no double-sends on restart.

## Constraints

- **Touch ONLY**:
  - `packages/db/src/schema/tasks.ts` (new)
  - `packages/db/src/schema/index.ts` (add exports)
  - `packages/db/src/schema/{mail,sequences}.ts` — minimal `idempotency_key` add
    to `message` and NOTHING ELSE (extend, don't rewrite)
  - `packages/db/src/tenancy-guard.test.ts` + testing.ts
  - `apps/worker/src/sequence/**` (new dir)
  - `apps/worker/src/index.ts` (register handlers + schedule tick)
  - `apps/web/src/lib/enrollments.functions.ts` (extend if pause/resume/stop
    weren't fully wired in Phase 5 — additive only)
  - `apps/web/src/lib/compose.functions.ts` (extend `sendComposedMessage` to
    call `captureManualAnchor` if `enrollmentId` provided — additive)
  - `scripts/load-test-engine.ts` (new)
- **DO NOT** modify `packages/core/**` — the state machine is pure, foundations
  owns it. If a bug forces it, mark RESULT `status:failed` with explanation.
- **DO NOT** modify Phase 5 sequence/enrollment schema fields — Phase 5
  pre-baked the columns you need.
- Context7 MCP for Drizzle raw SQL, pg-boss v12 schedule + retry options,
  Postgres advisory locks.

## Result

```json
{
  "status": "ok",
  "files": ["apps/worker/src/sequence/execute-step.ts", "..."],
  "notes": "Phase 6 engine complete. pnpm check green. Load test: 3 workspaces × 100 enrollments × 2 workers × 120s, zero duplicate idempotency_keys, zero cap breaches, all enrollments terminal or with valid next_run_at. Manual-first flow: anchor captured on send, follow-ups thread correctly, cap enforcement verified with daily_cap=2 test."
}
```
