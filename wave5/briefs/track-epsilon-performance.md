# TRACK EPSILON — Performance Indexes + DB Client Hardening

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave5-epsilon-performance` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md` + `WAVE_CONTEXT.md` (root) + `wave5/WAVE_CONTEXT.md`
2. `review/CONSOLIDATED.md`
3. `review/findings/performance.md` — full detail
4. `packages/db/src/schema/*.ts` — all schema files

## Findings assigned (17)

Per the performance review:

- **PERF-001 LOW** — Optional partial index on `enrollment(state, next_run_at)` where active
- **PERF-005 HIGH** — Cap count `reserved_at` filter but index on `window_start` — add `(mailbox_id, reserved_at)` index
- **PERF-006 MED** — `message` throttle partial index `(mailbox_id, sent_at DESC) WHERE direction='outbound' AND status='sent'`
- **PERF-007 HIGH + PERF-026** — Missing `message(enrollment_id)` index; funnel/inbox filters
- **PERF-011 MED** — `enrollment(organization_id, sequence_id)` index for analytics + inbox subqueries
- **PERF-013 LOW** — Inbox `thread_at = coalesce(received_at, sent_at)` generated column + index (OR separate queries per direction — pick lighter path)
- **PERF-015 HIGH** — `prospect(organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL` for default list sort
- **PERF-016 HIGH** — pg_trgm GIN indexes on `prospect.email`, `first_name`, `last_name`, `company.name`
- **PERF-017 MED** — Add queue-level retry backoff to `crm.writeback` job type
- **PERF-018 LOW** — CRM writeback context loading multiple queries (optional single-JOIN)
- **PERF-019 MED** — Webhook sweep 50/min + no concurrency cap; make configurable
- **PERF-020 MED** — pgvector prefetch removed from `retrieveValueProps` (currently does upfront findMany then cosine query)
- **PERF-021 LOW** — Org-scoped pgvector index (partition by org for large tenants — skip for now, document)
- **PERF-022 HIGH** — Mailbox poll enqueues all mailboxes at cron edge; stagger via `hash(mailbox_id) % N` bucket; also index `mailbox(status)`
- **PERF-025 LOW** — Prospect timeline: `event(organization_id, entity_id, created_at)` index (BETA will build the timeline; you provide the index)
- **PERF-027 MED** — Document / configure `postgres.js prepare: false` for PgBouncer compatibility
- **PERF-028 LOW** — Turbo `typecheck` cache miss — add `.tsbuildinfo` outputs

## Documentation lookup (mandatory)
Context7 MCP for:
- **PostgreSQL 17** — pg_trgm extension enabling, GIN vs GiST for ILIKE, partial index syntax
- **Drizzle-kit** — schema DSL for `index().on(...)`, `.where()` for partial indexes, `sql\`\`` for raw expression indexes
- **pg-boss v12** — job type default options (`retryBackoff`, `retryDelay`), configuring per-queue team size
- **postgres.js** — `prepare: false` implications

## Tasks

### T1 — pg_trgm setup + indexes (PERF-016)

Migration that runs `CREATE EXTENSION IF NOT EXISTS pg_trgm;` then adds:
```sql
CREATE INDEX prospect_email_trgm_idx ON prospect USING GIN (email gin_trgm_ops);
CREATE INDEX prospect_first_name_trgm_idx ON prospect USING GIN (first_name gin_trgm_ops);
CREATE INDEX prospect_last_name_trgm_idx ON prospect USING GIN (last_name gin_trgm_ops);
CREATE INDEX company_name_trgm_idx ON company USING GIN (name gin_trgm_ops);
```

Drizzle-kit may not generate `USING GIN (col gin_trgm_ops)` — you may need a
hand-written migration append or a `sql\`\`` template in the schema `.on()` call.
Verify with `pnpm db:migrate` + `EXPLAIN` on a sample query.

### T2 — Missing indexes for hot join paths (PERF-005, PERF-006, PERF-007, PERF-011, PERF-015)

- `message(enrollment_id)` — `enrollment_id_idx` (btree)
- `message(mailbox_id, sent_at DESC) WHERE direction='outbound' AND status='sent'` — partial (throttle lookup)
- `send_reservation(mailbox_id, reserved_at)` — cap count (PERF-005). Verify if window_start also needed; drop the current `(mailbox_id, window_start)` if redundant.
- `enrollment(organization_id, sequence_id)` — analytics
- `enrollment(organization_id, state)` — inbox filter
- `prospect(organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL` — list sort

### T3 — Inbox thread_at (PERF-013)

Add generated column to `message`:
```ts
threadAt: text("thread_at").generatedAlwaysAs(sql`coalesce(received_at, sent_at)`, { mode: "stored" }),
```
Plus index `(organization_id, thread_at DESC)`.

Update `apps/web/src/lib/inbox.functions.ts` to `ORDER BY thread_at DESC`.

If generated column proves painful with Drizzle, fall back to two separate queries
(inbound / outbound) per Perf recommendation.

### T4 — pgvector prefetch removal (PERF-020)

**Location**: `packages/ai/src/generation/prompt-builder.ts:19-57`

`retrieveValueProps` currently `findMany` first then cosine query. Remove the prefetch;
run only the cosine similarity query with `organization_id` filter.

### T5 — Mailbox poll stagger + index (PERF-022)

- Add `mailbox(status, id)` index if not present (helps active-mailbox scan)
- Change `apps/worker/src/handlers/mailbox-poll.ts` scheduler to stagger: instead of
  enqueuing all mailboxes at once, use `hash(mailbox_id) % 4` bucketing to spread
  across 4 slots within the 2min window
- Wait — this touches `mailbox-poll.ts` which DELTA touches for Graph pagination.
  Coordinate: your changes are surgical to the tick handler + index; DELTA's are
  surgical to the pollMicrosoft function. NEEDS.md if worried.

### T6 — pg-boss retry backoff on `crm.writeback` (PERF-017)

Extend `enqueueWithRetries('crm.writeback', ...)` wrapper (or per-call options) to
include:
```ts
{ retryLimit: 5, retryDelay: 60, retryBackoff: true, retryDelayMax: 3600 }
```

Also raise `webhook.deliver` team size and make sweep interval / limit env-configurable.

### T7 — postgres.js prepare: false (PERF-027)

Extend `packages/db/src/client.ts`:
```ts
const usePool = env.DATABASE_POOLER_MODE === "transaction";  // new optional env var
const client = postgres(env.DATABASE_URL, usePool ? { prepare: false } : {});
```
Add `DATABASE_POOLER_MODE` to env schema as optional enum.

Document in `docs/self-host.md` (create if not there — coordinate with README).

### T8 — Turbo cache (PERF-028)

Update `turbo.json`:
```json
"typecheck": {
  "dependsOn": ["^typecheck"],
  "outputs": [".tsbuildinfo", "**/*.tsbuildinfo"]
}
```

Update each package's `tsconfig.json` (via extends) to enable `tsBuildInfoFile`.

### T9 — Analytics event(prospect_id) index (PERF-025)

Extend `event` schema with `(organization_id, prospect_id, created_at DESC)` index.
Requires an `entity_type = 'prospect'` filter to be useful; document the query pattern.

## Files owned (strict)

- **`packages/db/src/schema/*.ts`** — all schema files, ADD indexes only. Do NOT change
  column shapes (BETA might extend `message.sentiment` — coordinate)
- `packages/db/drizzle/**` — the generated migration for wave5_epsilon_perf_indexes
- `packages/db/src/client.ts` (PERF-027)
- `packages/queue/src/boss.ts` (PERF-017 default retry options)
- `apps/worker/src/handlers/mailbox-poll.ts` — the SCHEDULER portion (T5). NEEDS.md if
  DELTA changes are within the same function.
- `apps/worker/src/handlers/webhook-deliver.ts` — sweep tuning
- `packages/ai/src/generation/prompt-builder.ts` (PERF-020 — coordinate with DELTA
  CR-011 + GAMMA SEC-008; your change is at retrieval, not the prompt-build path)
- `turbo.json` (PERF-028)
- `packages/config/src/env.schema.ts` — add `DATABASE_POOLER_MODE` optional enum (this
  file is heavily touched by GAMMA CR-008 + SEC-012. Coordinate.)
- `docs/self-host.md` — extend or create

## Do NOT touch

- Server-fn code — DELTA + BETA + GAMMA + ALPHA
- Migration files from earlier phases — never edit
- Test files — ZETA

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name wave5_epsilon_perf_indexes
pnpm db:migrate
pnpm check
```

Manual smoke:
- `EXPLAIN ANALYZE` a prospect sort-by-email query → verify pg_trgm index used
- `EXPLAIN ANALYZE` funnel query → verify `message(enrollment_id)` index used
- Turbo re-run of `pnpm typecheck` should now hit cache

## Result

```json
{
  "status": "ok",
  "track": "EPSILON",
  "findings_addressed": ["PERF-001", "PERF-005", "PERF-006", "PERF-007", "PERF-011", "PERF-013", "PERF-015", "PERF-016", "PERF-017", "PERF-018", "PERF-019", "PERF-020", "PERF-021", "PERF-022", "PERF-025", "PERF-026", "PERF-027", "PERF-028"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
