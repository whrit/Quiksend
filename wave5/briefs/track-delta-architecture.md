# TRACK DELTA — Architecture Cleanup + Correctness Fixes

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave5-delta-architecture` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md` + `WAVE_CONTEXT.md` (root) + `wave5/WAVE_CONTEXT.md`
2. `review/CONSOLIDATED.md`
3. `review/findings/architecture.md` + `review/findings/correctness.md` + `review/findings/performance.md`
4. `packages/mail/**`
5. `packages/ai/**`
6. `apps/worker/src/handlers/mailbox-poll.ts` (Microsoft Graph section)

## Findings assigned (14)

- **CR-009 HIGH** — Decouple `packages/mail` from `packages/integrations`
- **CR-011 HIGH** — AI provider metadata bypass
- **CR-012 HIGH** — Microsoft Graph delta poll missing pagination
- **CR-013 HIGH** — Prospect keyset cursor uses `created_at` regardless of `sortField`
- **CR-014 HIGH** — 5000-row CSV import runs sync
- **ARCH-006 MEDIUM** — Enroll-with-anchor hand-rolls schedule math
- **ARCH-008 MEDIUM** — `@quiksend/mail` root exports adapter internals
- **ARCH-010 MEDIUM** — `_protected` layout guard weaker than `orgFn`
- **ARCH-011 MEDIUM** — Zod schemas duplicated between server-fns and API
- **ARCH-012 LOW** — `packages/core` declares unused `@quiksend/config` dep
- **ARCH-013 LOW** — Duplicate enrollment state writes in executor
- **ARCH-014 LOW** — Informational (no action)
- **ARCH-015 LOW** — Informational (no action)
- **ARCH-016 LOW** — Informational (no action)

## Documentation lookup (mandatory)
Context7 MCP for:
- **Microsoft Graph** — `@odata.nextLink` semantics on `/me/messages/delta`; page size
- **`ai` SDK** — provider factories `.modelId` accessor for stored metadata
- **Drizzle ORM** — column keyset pagination compound comparisons

## Tasks

### T1 — Fix CR-009 (decouple packages/mail from packages/integrations)

**Root cause**: `packages/mail/src/adapters/index.ts:2-7` imports `getNango` from `@quiksend/integrations`.

Approach:
- Add `NangoProxyClient` interface to `packages/mail/src/adapter.ts` (or a new
  `packages/mail/src/nango-proxy.ts`):
  ```ts
  export interface NangoProxyClient {
    get(input: { endpoint: string; connectionId: string; providerConfigKey: string; params?: Record<string, string> }): Promise<{ data: unknown }>;
    post(input: { endpoint: string; connectionId: string; providerConfigKey: string; data: unknown }): Promise<{ data: unknown }>;
  }
  ```
- `createGmailAdapter` and `createMicrosoftAdapter` accept `nangoProxy: NangoProxyClient`
  as a required parameter (config or explicit second arg).
- `createAdapterForMailbox` also accepts `nangoProxy` — required when provider is
  gmail/microsoft.
- Move `getNango()` reading out of `packages/mail`. Remove the `@quiksend/integrations`
  dependency from `packages/mail/package.json`.
- `apps/worker/src/sequence/mailbox-adapter.ts` becomes the wiring point: constructs
  a `NangoProxyClient` from `getNango()` and passes to `createAdapterForMailbox`.
- `apps/web/src/lib/mailboxes.functions.ts`, `compose.functions.ts`, `inbox.functions.ts`
  (BETA is updating these for OAuth support) — coordinate. Give them a helper
  `getMailboxAdapter(mailbox)` in a web-app-scoped file that wires the Nango client.

Add unit test: create `createGmailAdapter` with a fake `NangoProxyClient`; assert the
`send` call routes through it.

### T2 — Fix CR-011 (AI provider metadata)

**Location**: `packages/ai/src/generation/generate-email.ts:13-16`

Change `getDefaultModel()` to return `{ model, modelId, provider }` tuple. Callers use
`modelId` for persistence. Delete `modelId()` helper.

Test: assert `generation.model` in DB matches the actually-invoked model.

### T3 — Fix CR-012 (Microsoft Graph delta pagination)

**Location**: `apps/worker/src/handlers/mailbox-poll.ts:398-460`

Loop on `@odata.nextLink` until exhausted or a page cap (e.g. 20 pages per poll).
Deduplicate messages by provider id in case the delta returns overlapping windows.
Log page count for observability.

Add unit test: mock the fetch layer to return 3 pages; assert all messages processed.

### T4 — Fix CR-013 (prospect keyset cursor)

**Location**: `apps/web/src/lib/prospects.functions.ts:251-282`

Extend cursor payload:
```ts
type Cursor = { field: SortField; value: string; id: string };
```

Compound cursor predicate: `(sortColumn, id) < (cursor.value, cursor.id)` when descending.

Add composite indexes per sort mode (this crosses into EPSILON territory — write to
NEEDS.md that EPSILON should add: `(org_id, email, id)`, `(org_id, first_name, id)`, etc.)

Regression test in prospect-tenancy.test.ts (or new prospect-list.test.ts): insert 10
prospects with staggered emails; list with sort=email; page through; assert no
duplicates + no missed rows.

### T5 — Fix CR-014 (CSV import async)

**Location**: `apps/web/src/lib/prospects.functions.ts:191, 709-810` + `prospect-import.ts`

Extract row processing into an `import.process` pg-boss job. `startImport` writes the
`import_batch` row with `status='queued'` + parsed rows to a temp table or serialized
into the batch's `raw_rows` jsonb column. Enqueue. Return batch_id immediately.

Worker handler `apps/worker/src/handlers/import-prospects.ts` — reads batch, processes
in chunks of 500 using `INSERT ... ON CONFLICT DO UPDATE`, streams progress into
`import_batch.created_count`/`updated_count`/etc.

Frontend polling: `/prospects/import` page polls batch status until `status='done'`
(exists or new field), then shows final summary.

Test: end-to-end with 100 rows; verify batch completes + counts match.

### T6 — Fix ARCH-006 (enroll-with-anchor via computeSchedule)

**Location**: `apps/web/src/lib/enrollments.functions.ts:54`, `apps/worker/src/sequence/anchor.ts:110-112`

Both hand-roll `anchor + delayMinutes * 60_000`. Replace with `computeSchedule`
from `@quiksend/core/schedule` — same function used by the builder preview + normal
enroll. Match `apps/web/src/routes/api/v1/enrollments.ts:65` pattern.

### T7 — Fix ARCH-008 (mail public exports)

**Location**: `packages/mail/src/index.ts:33-43`

Remove `GmailAdapterConfig`, `MicrosoftAdapterConfig`, `NangoProxyClient`, direct
adapter factories from root exports. Keep `MailboxAdapter` interface,
`createAdapterForMailbox`, `createFakeAdapter`, `buildMime`, `normalizeMessageId`,
`buildComplianceParts`, `buildThreadingHeaders`, `mintUnsubscribeToken`, `verifyUnsubscribeToken`.

Provider configs remain as subpath exports (`@quiksend/mail/adapters/gmail`) for
adapter tests. Update the `exports` map in `packages/mail/package.json`.

Cascade: any consumer importing removed types needs to switch to subpath. Grep + fix.

### T8 — Fix ARCH-010 (align `_protected` layout with orgFn)

**Location**: `apps/web/src/routes/_protected.tsx:7-14`

`beforeLoad` currently only checks session. Extend to also require an active
workspace + member row. Redirect unauthenticated users to `/login`; redirect
authenticated but no-workspace users to `/onboarding` (which you also need to add —
or a simpler "Create your first workspace" screen).

Add tests for the guard.

### T9 — Fix ARCH-011 (shared Zod schemas)

Create `apps/web/src/lib/schemas/{prospect,sequence,enrollment,webhook,api-key}.ts`
or move to `packages/core/src/schemas/` if cross-package. Export shared Zod schemas.
Import from both `*.functions.ts` and `/api/v1/*` handlers.

Concretely: pick one entity (prospects is most-touched), extract its schema, wire
both consumers, ship. Note remaining entities as follow-up in RESULT.

### T10 — Fix ARCH-012 (remove unused @quiksend/config from core)

`packages/core/package.json:17-18` — remove the `@quiksend/config` dep. Regenerate
lockfile.

### T11 — Fix ARCH-013 (duplicate enrollment state writes)

**Location**: `apps/worker/src/sequence/effects.ts:54-55 + 170-178 + 66-77`

WAIT — this file is ALPHA territory. Do NOT touch. Note in RESULT that ARCH-013 is
deferred to ALPHA's effect executor extraction (CR-010).

## Files owned (strict)

- `packages/mail/**` — full ownership for CR-009 decoupling + ARCH-008
- `packages/ai/**` — full ownership (except `research/fetch-and-summarize.ts` and
  `generation/prompt-builder.ts` which GAMMA touches for SEC-008 — coordinate; your
  changes to CR-011 don't overlap SEC-008's changes)
- `apps/worker/src/handlers/mailbox-poll.ts` (CR-012 Graph pagination — Microsoft
  section only; Gmail section is untouched)
- `apps/worker/src/sequence/mailbox-adapter.ts` — extend for Nango injection
- `apps/worker/src/handlers/import-prospects.ts` — NEW
- `apps/web/src/lib/prospects.functions.ts` — CURSOR fix + CSV async (extension only;
  BETA + ALPHA also touch this file — coordinate via NEEDS.md if concerned; your
  changes are surgical to keyset cursor + CSV entry point)
- `apps/web/src/lib/prospect-import.ts`
- `apps/web/src/lib/enrollments.functions.ts` (ARCH-006 anchor scheduling)
- `apps/web/src/routes/_protected.tsx` (ARCH-010)
- `apps/web/src/routes/_protected/onboarding.tsx` — NEW if needed
- `apps/web/src/lib/schemas/**` — NEW dir for shared Zod schemas
- `packages/core/package.json` (remove dep)
- `apps/web/src/lib/mailbox-adapter.ts` — NEW helper if needed for the OAuth compose wiring

## Do NOT touch

- `apps/worker/src/sequence/effects.ts`, `execute-step.ts`, `tick.ts`, `guards.ts`,
  `reserve-slot.ts`, `anchor.ts` — ALPHA
- Sequence step schema — BETA + ALPHA share
- `apps/web/src/lib/compose.functions.ts`, `inbox.functions.ts` — extensively used
  by ALPHA + BETA + GAMMA. Only touch if your change is surgical + non-overlapping
  with theirs. If unsure: NEEDS.md.
- Public API `/api/v1/*` — read-only reference for ARCH-011 shared schema extraction
- `packages/db/src/schema/**` — EPSILON owns index additions; if you must add a column
  (e.g. `import_batch.status` if it doesn't have one), coordinate via NEEDS.md
- Test files for entities not in your scope — ZETA

## Verification

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm tsx scripts/load-test-engine.ts   # must still pass
```

Manual smoke:
- Import a 100-row CSV → verify the batch completes async + counts populate
- Enroll with an existing message anchor → verify next_run_at respects sending window
- Sort prospects by email → paginate → verify no duplicates
- Connect a Microsoft mailbox with > 100 delta records → verify all messages appear

## Result

```json
{
  "status": "ok",
  "track": "DELTA",
  "findings_addressed": ["CR-009", "CR-011", "CR-012", "CR-013", "CR-014", "ARCH-006", "ARCH-008", "ARCH-010", "ARCH-011", "ARCH-012"],
  "findings_deferred": ["ARCH-013 → ALPHA CR-010"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
