# WAVE_CONTEXT.md — Wave 3 (Phase 6 engine + Phase 7/8 side-quests)

**Read `CLAUDE.md` + root `WAVE_CONTEXT.md` first.**

Wave 3 is the highest-risk phase of the whole plan: the engine that drives real
sends. Phase 6 correctness dictates whether Quiksend can actually be trusted with
a mailbox.

## Tracks (three agents, non-symmetric)

| Track                             | Phase                                                                                                  | Role                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Track G** — engine              | Phase 6 (scheduler tick + step executor + reserveSendSlot + idempotency + manual-first anchor capture) | The serial gate. ONE agent. Highest correctness bar. |
| **Track H** — inbound scaffolding | Phase 7 prep (poller helpers, DSN/bounce parser, Message-Id normalization already exists)              | Parallel side-quest, no engine dependency            |
| **Track I** — AI interfaces       | Phase 8 prep (packages/ai model + search interfaces, value_prop CRUD)                                  | Parallel side-quest, no engine dependency            |

## Ground rules

- Same as prior waves: Context7 MCP, orgFn, `pnpm check` green, explicit extensions.
- **Track G specifically**: the state machine in `packages/core/src/state-machine/`
  is already pure + exhaustively tested (foundations). Track G ADDS the WORKER
  INTERPRETER — the effects (`send_auto`, `advance_step`, `capture_anchor`,
  `terminate`) that the pure transition emits get carried out here.
  DO NOT modify `packages/core` — extend by adding an executor in
  `apps/worker/src/sequence/`.

## The three highest-risk pieces (Track G specifically)

### 1. `SELECT ... FOR UPDATE SKIP LOCKED`

The scheduler tick must claim due enrollments without two workers grabbing the
same row. Use raw SQL via drizzle's `sql\`\``template — the ORM's high-level
query helpers don't emit SKIP LOCKED. Test with two`apps/worker` processes
against the same DB and assert no double-send.

### 2. Slot reservation atomicity

`reserveSendSlot(mailbox)` must be atomic — two concurrent enrollments must not
both reserve the last cap slot. Options:

- Advisory lock (`pg_advisory_xact_lock(mailbox_id)`) + count.
- Insert into a `send_reservation` table with a partial unique index that
  represents the cap constraint.
  Pick one, defend it, unit test it under contention (simulate concurrent
  reservations against the CI Postgres).

### 3. Idempotency key

Every outbound send writes a `message` row with a unique
`idempotency_key = (enrollment_id, step_id, attempt)`. Retried jobs check for
an existing send row before invoking the adapter. Test: a retried job after a
crashed send does not double-send at the provider.

## New tables Wave 3 adds (Track G)

- `task` — for manual_email compose tasks + task steps. FK to enrollment.
- `send_reservation` — or the advisory-lock approach doesn't need this.
- Extend `enrollment` with `attempt_count`, `last_error`, `idempotency_key`
  — Wave 2 (Phase 5) already pre-baked these. Track G just writes them.

## Track H (Phase 7 prep) — pure logic modules

- `packages/mail/src/bounce.ts` — DSN parser. Take raw MIME text, return
  `{ type: 'hard'|'soft', code: string|null, recipient: string|null, diagnostic: string|null }`
  or null when the message is not a bounce. Exhaustively tested against a corpus
  of provider bounce samples in `packages/mail/src/bounce.samples/*.eml`.
- `packages/mail/src/inbound-matching.ts` — given inbound `In-Reply-To` +
  `References`, return the matching outbound `message.message_id_header` if any.
  Use `normalizeMessageId` from threading.ts.
- Both are pure, no I/O — the poller wires them in Wave 4.

## Track I (Phase 8 prep) — packages/ai

- Provider-agnostic interfaces (`ModelProvider`, `SearchProvider`).
- `value_prop` schema + CRUD server fns (pre-baked for Phase 8's prompt builder).
- `research_profile` schema.
- The research + generation pipelines land in Wave 4 (Phase 8 proper).

## Coordination

Track G touches `apps/worker/src/sequence/`, `packages/db/src/schema/tasks.ts`.
Track H touches `packages/mail/src/{bounce,inbound-matching}.ts`.
Track I touches `packages/ai/` (new package) + `packages/db/src/schema/ai.ts`.
Zero file overlap — clean parallel merge.
