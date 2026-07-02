# WAVE_CONTEXT.md — cross-phase decisions for Wave 1 (Phases 2, 3-back-half, 4-back-half)

**Read this before your brief.** It captures the decisions the three parallel tracks
must agree on. Foundation work landed in v1.1.0 (commit `1b4a564`) — see `CLAUDE.md`
and the phase plan at `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md`.

## Ground rules (all tracks)

- **Documentation lookup**: for **every** package/library/framework/API you use (Drizzle,
  TanStack Start, TanStack Table, Better Auth, Nango, nodemailer, papaparse, dnd-kit,
  Zod, pg-boss, etc.) you MUST fetch up-to-date docs via the **Context7 MCP server**
  before writing calls. Prefer Context7 over your training data — versions drift and
  APIs change. If Context7 is unavailable, say so in your PR notes; don't guess.
- **`orgFn` is THE tenancy chokepoint.** Every data-touching server function MUST
  compose `authMiddleware` from `apps/web/src/lib/org-fn.ts`. Every app-scoped query
  MUST filter by `context.orgContext.organizationId`. When you add an app-scoped
  table, flip it on in `packages/db/src/tenancy-guard.test.ts` under `APP_SCOPED_TABLES`
  so the tenancy CI guard activates.
- **`pnpm check` MUST be green** before you write `RESULT.json` with `status: "ok"`.
  Zero lint errors, zero type errors, zero failing tests. No exceptions. If you
  can't get there, write `status: "failed"` with notes explaining what remains.
- **Explicit `.ts`/`.tsx` extensions in relative imports** (project convention;
  `verbatimModuleSyntax` + `isolatedModules` are on). `import type` for type-only.
- **No cross-package relative imports.** Everything goes through `@quiksend/*`.
- **NEVER** hand-edit `apps/web/src/routeTree.gen.ts` — it's generated on `pnpm web:dev`
  build. You MAY commit the regenerated version at the end of your work.
- Conventional-commit style is enforced by CI on your PR title.

## Cross-track coordination

### Migrations

Each track adds a new schema file + a new migration. On generate, drizzle-kit
numbers sequentially (`0002_...`, `0003_...`). Since three PRs are open in parallel,
the second and third to merge will need to **rebase and regenerate** the migration
number. That's expected — do NOT rename another track's migration. Your track only
touches its own migration file (and, per convention, migrations are additive; never
edit an already-applied migration in another PR).

### Shared surfaces that WILL merge cleanly

- `packages/db/src/schema/index.ts` — you'll add one `export * from "./<yours>.ts"` line.
  A three-way barrel merge is trivial and mechanical.
- `.env.example` — additive per phase; append your track's block.
- `apps/web/src/routes/_protected/` — each track adds its own subdirectory.
- `apps/web/src/lib/*.functions.ts` — each track has its own file (see per-brief).

### Track 2 pre-bakes Track 3's CRM columns on `prospect` + `company`

Per plan Appendix A #3 (the same pattern the foundations used for `message`
inbound columns), **Track 2 pre-defines** these NULLABLE columns on `prospect` and
`company` so Track 3 doesn't have to migrate them later:

- `crm_provider text` (nullable) — `"salesforce"` | `"hubspot"` | null
- `crm_external_id text` (nullable)
- `crm_connection_id uuid` (nullable, references `crm_connection.id` — but
  Track 2 does NOT add the FK because `crm_connection` doesn't exist yet; Track 3
  adds the FK in its own migration once its table exists)
- `last_crm_sync_at timestamptz` (nullable)

Add a partial unique index `(organization_id, crm_provider, crm_external_id) WHERE
crm_external_id IS NOT NULL` so Track 3's upsert dedupes cleanly.

### Track 4's `message` table is designed for inbound from day one

Per plan Appendix A #3 — nullable `direction` defaulting to `outbound`, nullable
`bounce_type`, nullable `dsn jsonb`, nullable `received_at`. Phase 7 will fill these
without another migration.

## File ownership boundaries (STRICT)

| Track                                 | Owns exclusively                                                                                                                                                                                                                                                                                                                  | Reads only                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Track 2** (prospects/companies)     | `packages/db/src/schema/prospects.ts` (contains `company`, `prospect`, `list`, `list_member`, `import_batch`, `import_error`) + `apps/web/src/routes/_protected/prospects/**` + `apps/web/src/lib/prospects.functions.ts` + `apps/web/src/lib/prospect-import.ts` + `apps/web/src/lib/prospect-tenancy.test.ts`                   | `packages/core`, `packages/db/src/{client,index,testing}.ts`, `apps/web/src/lib/org-fn.ts`                                    |
| **Track 3** (Nango + CRM sync)        | `packages/db/src/schema/crm.ts` (contains `crm_connection`, `sync_state`) + `packages/integrations/src/sync/**` + `apps/web/src/routes/_protected/settings/crm/**` + `apps/web/src/routes/api/nango/**` + `apps/web/src/lib/crm.functions.ts` + `apps/worker/src/handlers/crm-sync.ts`                                            | `packages/db/src/schema/prospects.ts` (from Track 2 — Track 3 UPDATES `prospect`/`company` rows, does NOT alter their schema) |
| **Track 4** (mailboxes + single send) | `packages/db/src/schema/mail.ts` (contains `mailbox`, `message`) + `packages/mail/src/adapters/smtp.ts` + `packages/mail/src/dns.ts` + `apps/web/src/routes/_protected/settings/mailboxes/**` + `apps/web/src/routes/_protected/compose/**` + `apps/web/src/lib/mailboxes.functions.ts` + `apps/web/src/lib/compose.functions.ts` | `packages/db/src/schema/prospects.ts` (sending to a prospect id)                                                              |

**If a track needs a file outside its owned set, write a `NEEDS.md` note at the
worktree root explaining what and why, and mark RESULT.json `status: "failed"` so
Beckett can arbitrate.**

## Nango hosting

Nango **Cloud** was chosen (not self-hosted). `NANGO_SECRET_KEY` env var + optional
`NANGO_WEBHOOK_SECRET` are already declared in `packages/config/src/env.schema.ts`.

## Verification (all tracks)

Before writing `RESULT.json: {"status":"ok"}`:

```bash
pnpm install --frozen-lockfile   # first thing on a fresh worktree
pnpm db:generate                  # generates your new migration
pnpm db:migrate                   # applies it against localhost:5432
pnpm check                        # MUST be green: lint + format + typecheck + test
```

If a smoke test is possible without hitting a real 3rd-party service, run it and
attach the output to your RESULT notes.
