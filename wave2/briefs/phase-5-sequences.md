# PHASE-5: Sequence Model + Builder + Enrollment — Track E

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-5-sequences` from `main` (worktree isolated).

## Context

Read at repo root first, in order:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (root) + `wave2/WAVE_CONTEXT.md`
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md`
   section "Phase 5 — Sequence model & builder"
4. `packages/core/src/schedule/index.ts` — the `computeSchedule` function you IMPORT
   for the schedule preview (don't reimplement; one source of truth)
5. `packages/db/src/schema/{prospects,mail}.ts` — Wave-1 tables you FK to

Wave-1 landed prospect/company + mailbox tables. Phase 5 adds sequence definitions

- enrollment records. Phase 6 (Wave 3) drives them; Phase 5 only writes them.

## Documentation lookup (mandatory)

Context7 MCP for:

- **@dnd-kit/core** + **@dnd-kit/sortable** — DndContext, SortableContext,
  useSortable, arrayMove
- **Drizzle ORM** — pg enums, jsonb columns, `references` FKs, unique constraints
- **TanStack Start** — server-fn conventions
- **Zod v4** — discriminated unions for step type

## Tasks

### T1 — Schema (`packages/db/src/schema/sequences.ts`)

- **`sequence`** — id (uuid pk), organization_id (text FK cascade), name (text notNull),
  status pg enum ('draft', 'active', 'archived') default 'draft' notNull,
  settings jsonb notNull default `{}` — validated at write time to shape:

  ```ts
  { timezone: string, throttle_seconds: number, mailbox_ids: string[],
    stop_on_reply: boolean, business_days_only: boolean }
  ```

  created_by_user_id (text FK → user.id), deleted_at, timestamps.

- **`sequence_step`** — id (uuid pk), sequence_id (uuid FK cascade),
  organization_id (text FK cascade — denormalized for tenancy queries),
  step_index int notNull (0-based),
  step_type pg enum ('manual_email', 'auto_email', 'wait', 'task') notNull,
  delay_minutes int notNull default 0,
  business_days_only boolean notNull default true,
  config jsonb notNull — shape depends on step_type:
  - manual/auto_email: `{ subject: string, body_template: string, ai_generate: boolean }`
  - wait: `{ minutes: number }` (redundant with delay_minutes; used when a
    wait step is between two send steps)
  - task: `{ title: string, instructions: string }`
    variant_b jsonb nullable — same shape as `config` when step_type is a \*\_email
    entry_condition jsonb nullable — e.g. `{ kind: "if_no_reply" }`
    timestamps.
    Unique `(sequence_id, step_index)`.
    Index `(organization_id, sequence_id)`.

- **`enrollment`** — the record Phase 6 (Wave 3) drives.
  id (uuid pk), organization_id (text FK cascade),
  sequence_id (uuid FK cascade),
  prospect_id (uuid FK → prospect.id cascade),
  mailbox_id (uuid FK → mailbox.id — round-robin assigned at enroll),
  state text default 'active' notNull (values wired to `packages/core` state machine:
  'active' | 'waiting' | 'waiting_manual' | 'paused' | 'stopped' | 'completed' |
  'replied' | 'bounced' | 'failed'),
  current_step_index int default 0 notNull,
  next_run_at timestamptz nullable,
  **Pre-baked for Phase 6 (nullable now):**
  - anchor_message_id text nullable
  - anchor_thread_id text nullable
  - attempt_count int default 0 notNull
  - last_error text nullable
  - idempotency_key text nullable
    ab_bucket text nullable ('A' | 'B'),
    created_by_user_id (text FK → user.id),
    timestamps.
    Unique `(organization_id, sequence_id, prospect_id)` — no double-enrollment.
    Index `(state, next_run_at)` — Phase-6 scheduler hot path.
    Index `(organization_id, prospect_id)` — prospect timeline.

Barrel export from `packages/db/src/schema/index.ts`:

```ts
export * from "./sequences.ts";
```

### T2 — Activate tenancy guard

Add `sequence`, `sequence_step`, `enrollment` to `APP_SCOPED_TABLES` in
`packages/db/src/tenancy-guard.test.ts`. Add to `APP_SCOPED_TABLES_TO_TRUNCATE`
in `packages/db/src/testing.ts` — order: `enrollment`, `sequence_step`, `sequence`.

### T3 — Migration

`pnpm db:generate --name phase5_sequences_enrollment` → review → `pnpm db:migrate`.

### T4 — Server functions (`apps/web/src/lib/sequences.functions.ts`)

- `listSequences({ status?, search? })` — org-scoped.
- `getSequence({ id })` — includes ordered `sequence_step`s + summary counts
  (enrollments by state).
- `createSequence({ name, settings })` — draft-only.
- `updateSequence({ id, patch })` — draft-only OR active with subset of settings.
- `reorderSteps({ sequenceId, orderedIds })` — atomic transactional update to
  `step_index` on each step; guards against gaps or dupes.
- `upsertStep({ sequenceId, step: { id?, index, type, delayMinutes,
businessDaysOnly, config, variantB?, entryCondition? } })` — Zod discriminated
  union on `type`. Validates template tokens against known prospect fields
  (see T5) and rejects unknowns.
- `deleteStep({ id })` — draft-only.
- `activateSequence({ id })` — flips status draft→active; validates:
  - > = 1 step
  - Every \_email step has a subject + body_template that's non-empty (unless
    `ai_generate: true`)
  - settings.mailbox_ids all exist + in the org
- `archiveSequence({ id })`.
- `enrollProspects({ sequenceId, prospectIds })` — round-robin `mailbox_id` from
  the sequence's `settings.mailbox_ids`. Unique constraint enforces no
  double-enrollment; return skipped ids explicitly. Computes `next_run_at` using
  `computeSchedule` from `@quiksend/core/schedule` (the pure function) so the
  preview matches reality.
- `previewSchedule({ sequenceId, prospectId, mailboxId })` — server fn returning
  `computeSchedule(steps, mailboxSchedule, anchor)` output for the UI.
- `pauseEnrollment` / `resumeEnrollment` / `stopEnrollment` — state transitions
  via `transition` from `@quiksend/core/state-machine`; the executor (Phase 6)
  will interpret the effects.

### T5 — Template-token validation (`apps/web/src/lib/sequence-templates.ts`)

Pure module:

- `KNOWN_TOKENS: readonly string[]` — `first_name`, `last_name`, `email`, `title`,
  `company_name`, `company_domain`, `sender_first_name`, `sender_signature`.
- `extractTokens(str) → readonly string[]` — matches `{{token_name}}` (allow
  whitespace tolerant `{{  first_name  }}`).
- `validateTemplate(str) → { valid: boolean; unknown: string[] }`.
- `renderPreview(str, sample) → string` — replaces tokens with sample values;
  used for the builder preview panel.

Unit tests in `apps/web/src/lib/sequence-templates.test.ts`.

### T6 — Builder UI (`apps/web/src/routes/_protected/sequences/`)

- `index.tsx` — sequences table (name, status, step count, enrollment counts,
  last modified). "New sequence" opens a dialog.
- `new.tsx` — create form.
- `$id/edit.tsx` — the builder:
  - **Ordered step list** — @dnd-kit sortable. Each step is a card with:
    edit-inline title (subject or task name), type badge, delay chip, actions
    dropdown (edit / duplicate / delete).
  - **Add step** button opens a Sheet with a Select for step type + type-specific
    fields (subject/body for email, minutes for wait, title/instructions for task).
  - **Settings panel** (right sidebar): timezone select, throttle input,
    business_days_only toggle, stop_on_reply toggle, mailbox multi-select
    (checkbox list of workspace mailboxes).
  - **A/B variant editor** — collapsible under each email step.
  - **AI-generate toggle** per email step (checkbox — the actual generation
    lands in Phase 8; the flag persists now).
  - **Template validation panel** — surfaces unknown-token warnings inline.
- `$id/enroll.tsx` — enroll dialog:
  - Prospect picker (typeahead + optional list picker for bulk).
  - "Preview schedule" panel calls `previewSchedule` and renders the computed
    per-step times as a table. Show each `ScheduleDeferral` reason as a small
    badge next to the step.
  - Confirm → `enrollProspects` → toast with counts.
- `$id/enrollments.tsx` — enrolled prospects table with state badge, current
  step, next_run_at, actions (pause/resume/stop).

### T7 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase5_sequences_enrollment
pnpm db:migrate
pnpm check   # green, zero tolerance
```

Manual smoke:

- Create a sequence (draft) with 3 steps: manual_email, wait 60m, auto_email.
- Configure settings (window, throttle, mailbox).
- Enroll one prospect; view the schedule preview and confirm times.
- Confirm the enrollment row exists with correct `mailbox_id`, `next_run_at`,
  `state = 'active'`.
- Pause/resume/stop cycles the state correctly (state machine dry-run, no send
  yet — that's Phase 6).

## Constraints

- **Touch ONLY**:
  - `packages/db/src/schema/sequences.ts` + `packages/db/src/schema/index.ts` (one export line)
  - `packages/db/src/tenancy-guard.test.ts` + `packages/db/src/testing.ts` (add table names)
  - `apps/web/src/lib/sequences.functions.ts` + `apps/web/src/lib/sequence-templates.{ts,test.ts}`
  - `apps/web/src/routes/_protected/sequences/**`
  - `apps/web/src/routes/routeTree.gen.ts` (auto)
- **DO NOT** modify `packages/core/` — you IMPORT `computeSchedule` +
  `transition`, don't extend them. Extensions land in Phase 6 (Wave 3).
- **DO NOT** touch `packages/mail/adapters/{gmail,microsoft}.ts` — Track F owns those.

## Result

```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/sequences.ts", "..."],
  "notes": "Phase 5 complete. pnpm check green. Builder supports 4 step types with dnd-kit reordering; schedule preview uses @quiksend/core computeSchedule (matches reality). Enrollment round-robin verified across 2 mailboxes."
}
```
