# PHASE-2: Prospects & Companies — Track A

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-2-prospects` from `main` (worktree, isolated).

## Context

Read these files at the repo root first, in order:

1. `CLAUDE.md` (architecture + conventions)
2. `WAVE_CONTEXT.md` (cross-phase decisions — READ THIS, it explains the CRM columns
   Track 2 pre-bakes for Track 3, migration numbering, and file boundaries)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` — sections
   "Cross-cutting conventions" and "Phase 2 — Prospects & Companies"

Foundations shipped in v1.1.0: `orgFn` middleware, `packages/core` (branded ids,
schedule math, state machine), shadcn breadth (dialog, form, table, tabs, dropdown,
select, badge, sonner…), TanStack Table + dnd-kit installed. Better Auth's
`organization` plugin = workspace. Every server fn goes through `orgFn`.

## Documentation lookup (mandatory)

For every non-trivial API call, fetch **live docs via the Context7 MCP server**
before writing code. Especially:

- **Drizzle ORM** (schema, migrations, `pgTable`, indexes, `on conflict do update`)
- **TanStack Start** (`createServerFn`, `createMiddleware`, `.inputValidator(zod)`)
- **TanStack Table** (`useReactTable`, sorting, filtering, pagination)
- **Zod** (v4 — this repo pins 4.4.3; API differs from v3)
- **papaparse** (`Papa.parse` streaming with `step` callback)
- **react-hook-form** + shadcn `Form` primitives (already installed)

If Context7 doesn't have a package, note it in RESULT.json.notes; don't guess.

## Tasks (do them in order)

### T1 — Schema (`packages/db/src/schema/prospects.ts`)

Create ONE new schema file exporting:

- **`company`** — id (uuid pk defaultRandom), organization_id (text notNull FK →
  `organization.id` onDelete cascade), name (text nullable), domain (text nullable,
  lowercased), industry, size, website, linkedin_url, custom_fields (jsonb),
  created_at (timestamptz defaultNow notNull), updated_at (timestamptz defaultNow
  notNull, `$onUpdate` → new Date()), deleted_at (timestamptz nullable).
  Indexes: `(organization_id)`, `(organization_id, domain) WHERE domain IS NOT NULL`
  (unique partial).
- **`prospect`** — id (uuid pk), organization_id, company_id (uuid nullable FK →
  `company.id` onDelete set null), email (text notNull, stored lowercased),
  first_name, last_name, title, linkedin_url, phone, timezone,
  **`status` pg enum** ('new', 'active', 'replied', 'bounced', 'unsubscribed',
  'do_not_contact') default 'new' notNull,
  **`source` pg enum** ('manual', 'csv', 'crm', 'api') default 'manual' notNull,
  custom_fields (jsonb), deleted_at, created_at, updated_at.
  **PRE-BAKE for Track 3 (per WAVE_CONTEXT.md):**
  - `crm_provider text` nullable
  - `crm_external_id text` nullable
  - `crm_connection_id uuid` nullable (NO FK yet — Track 3 adds it)
  - `last_crm_sync_at timestamptz` nullable
    Indexes: `(organization_id, email)` unique, `(organization_id, status)`,
    `(organization_id, company_id)`,
    `(organization_id, crm_provider, crm_external_id) WHERE crm_external_id IS NOT NULL`
    unique partial.
    Also pre-bake the same CRM columns + partial unique index on `company`.
- **`list`** — id, organization_id, name, description (text nullable),
  created_by_user_id (text FK → `user.id`), timestamps.
- **`list_member`** — id, list_id (FK), prospect_id (FK), created_at.
  Unique `(list_id, prospect_id)`.
- **`import_batch`** — id, organization_id, filename (text), mapping (jsonb),
  created_count (int default 0), updated_count (int default 0),
  skipped_count (int default 0), errored_count (int default 0),
  status text default 'processing', created_by_user_id (text FK), timestamps.
- **`import_error`** — id, batch_id (FK cascade), row_number (int), raw (jsonb),
  reason (text), created_at.

Re-export from `packages/db/src/schema/index.ts`:

```ts
export * from "./prospects.ts";
```

### T2 — Activate tenancy guard

In `packages/db/src/tenancy-guard.test.ts` add these tables to `APP_SCOPED_TABLES`:
`company`, `prospect`, `list`, `importBatch`. (`list_member` + `import_error` are
scoped transitively via their FK parents.) The guard scans your code and fails
CI if any of these table references lack `organizationId` in the same file.

In `packages/db/src/testing.ts` add these to `APP_SCOPED_TABLES_TO_TRUNCATE` so
integration tests truncate between runs: `import_error`, `import_batch`,
`list_member`, `list`, `prospect`, `company` (in that order — respect FK deps).

### T3 — Migration

`pnpm db:generate --name phase2_prospects_companies` → **review the generated SQL**
(especially the pg enum creation, partial unique indexes, and cascade behavior).
`pnpm db:migrate` to apply against local Postgres.

### T4 — Server functions (`apps/web/src/lib/prospects.functions.ts`)

Every fn composes `authMiddleware` from `../lib/org-fn.ts`. All queries scope by
`context.orgContext.organizationId`. Validate inputs with Zod
via `.inputValidator(...)`. Follow the existing shape of
`apps/web/src/lib/auth.functions.ts`.

- `listProspects(input)` — filters: status, listId, companyId, search (email/name
  ILIKE), sort field + dir, keyset pagination via `cursor: {id, createdAt}` +
  `limit` (default 50, cap 500).
- `getProspect({ id })` — returns prospect + company + list memberships. 404 when
  not in this org (never leak `organization_id` in the where clause result).
- `createProspect(input)` — dedupe on `(organization_id, email)`. If existing row
  is soft-deleted, restore instead of erroring.
- `updateProspect({ id, patch })` — patch is a narrow Zod object; unknown keys rejected.
- `deleteProspect({ id })` — soft delete (sets `deleted_at`).
- `bulkDeleteProspects({ ids })` — soft delete, requires all ids in the caller's org.
- `listCompanies(input)` — similar filters.
- `upsertCompany(input)` — dedupe on `(organization_id, domain)` where domain is
  present; otherwise dedupe on `(organization_id, name)` case-insensitive.
- `createList({ name, description? })`, `addToList({ listId, prospectIds[] })`,
  `removeFromList({ listId, prospectIds[] })`.
- `startImport({ mapping, rows, filename, dedupePolicy })` — takes parsed rows +
  mapping (server-fn, not the raw file). Returns `import_batch` id + summary.
  Small batches (< 500 rows) run inline; larger get enqueued via
  `enqueue("crm.import", ...)` — but the `crm.import` job type doesn't exist yet,
  so cap at 5000 rows inline for now, and note in RESULT that a Phase-6 async path
  is TODO. **This is acceptable** for Phase 2 — the phase plan explicitly allows it.

### T5 — CSV import mechanics (`apps/web/src/lib/prospect-import.ts`)

Pure module (no I/O beyond papaparse):

- `normalizeEmail(str) → string` — trim + toLowerCase; return null if invalid RFC5322.
- `normalizeDomain(str) → string | null` — trim, lowercase, strip protocol/path,
  return null if not a real domain (no `@`, no dots, or free-mail providers like
  `gmail.com`/`yahoo.com`/`outlook.com` — for company auto-link, we skip free-mail
  domains per the phase plan's risk note).
- `parseCsvStream(file, mapping) → { valid, invalid }` — uses papaparse
  streaming (`Papa.parse(file, { step, complete })`) so 100MB CSVs don't OOM.
  Emits `valid: { rowNumber, prospect, company? }[]` and
  `invalid: { rowNumber, raw, reason }[]`.
- `dedupePolicy` type: `"skip_existing" | "update_existing"`. Applied at the
  server-fn upsert boundary (`insert ... on conflict do nothing/update`).

Unit-test the pure fns in `apps/web/src/lib/prospect-import.test.ts` — cover:

- valid + invalid email normalization
- domain: corporate vs free-mail
- CSV with garbage rows (blank, missing email, wrong header) — invalid array
  populated correctly

### T6 — Tenancy integration test (`apps/web/src/lib/prospect-tenancy.test.ts`)

Using the `testing.ts` harness (extend `withTestOrgs()` if needed — you may add it
now). Test:

- Create prospect in orgA, orgB caller CANNOT read/update/delete it.
- Two orgs can each own a prospect with the same email; no cross-contamination.
- CRM columns (Track-3 pre-baked) are nullable and default to null.

### T7 — UI

**Prospects table** (`apps/web/src/routes/_protected/prospects/index.tsx`):

- TanStack Table with columns: checkbox, name, email, company, title, status
  (badge), source (badge), last activity, actions dropdown.
- Filters: search, status multi-select, list, company. Encode in URL search params
  (`useSearch`) so filters survive reload.
- Row-select for bulk delete + bulk add to list. Confirm via dialog.
- Pagination via cursor (keyset).
- "Add prospect" dialog (create manually).
- "Import CSV" button → routes to `.../prospects/import`.

**Prospect detail** (`apps/web/src/routes/_protected/prospects/$id.tsx`):

- Fields (inline edit via react-hook-form + shadcn Form + Zod).
- Company panel (link to company detail if exists).
- **Timeline shell** with placeholder sections: "Sequence history (Phase 5)",
  "Messages (Phase 4/7)", and a real "Field changes" event log driven by
  audit rows you can back with a lightweight in-file trigger later (for now,
  render just the created/updated import event + manual edits from `updated_at`).

**CSV Import wizard** (`apps/web/src/routes/_protected/prospects/import.tsx`):

- Step 1: upload (accept `.csv`, drop zone + file picker).
- Step 2: parse headers → column-mapping table (map each CSV column to a
  prospect/company field or "ignore"). Remember mapping per-org in localStorage
  keyed by header-hash.
- Step 3: preview 5 rows + validation report (X valid, Y invalid with reasons).
- Step 4: confirm + choose dedupe policy → call `startImport`.
- Step 5: batch summary + downloadable error CSV.

Show toasts on all mutations via `sonner` (already wired in `__root.tsx`).

### T8 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase2_prospects_companies
pnpm db:migrate
pnpm check   # MUST BE GREEN. Zero errors, zero warnings, zero failing tests.
```

If `pnpm check` fails, fix and re-run — do not write `RESULT.json: {"status":"ok"}`
until it's clean. Iterate. Zero-tolerance from Beckett.

Additionally, run the web dev server and:

- Sign in
- Create a workspace
- Import a small CSV (create one in `wave1/fixtures/sample-prospects.csv` with
  ~10 rows including one dup + one bad row) — confirm the wizard end-to-end.
- Confirm the prospects table renders, filters work, and detail page loads.
- Kill the dev server. Capture the observations in RESULT.notes.

## Constraints

- **Touch ONLY**: files listed under "Track 2 owns" in WAVE_CONTEXT.md, plus
  `packages/db/src/schema/index.ts` (add one export line), `.env.example` (append
  if you add env vars, unlikely), `apps/web/src/routes/routeTree.gen.ts` (auto-
  regenerated — commit it).
- **DO NOT** touch `packages/db/src/schema/{crm,mail}.ts` (Tracks 3 & 4).
- **DO NOT** modify `apps/web/src/lib/org-fn.ts` or any foundations package
  (`packages/{core,mail,integrations,queue,observability}`) unless a bug forces
  it — if so, note it clearly.
- Explicit `.ts`/`.tsx` extensions on all relative imports; `import type` for
  type-only imports.
- Use Context7 MCP for docs; do not rely on training data for Drizzle, TanStack
  Start, Zod v4, papaparse.

## Result

Write at repo root of your worktree:

```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/prospects.ts", "…"],
  "notes": "Phase 2 complete. pnpm check green. CSV import tested with fixtures/sample-prospects.csv (7 created, 1 updated, 1 skipped, 1 invalid). Migration 0002_phase2_prospects_companies applied cleanly."
}
```

Path: `RESULT.json` (in worktree root, not committed — `merge.sh` excludes it).
