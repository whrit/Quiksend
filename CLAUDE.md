# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quiksend is an open-source, self-hostable sales engagement platform (AI-personalized email
sequences with Salesforce/HubSpot ops) — an alternative to Outreach.io / Salesforge.ai. It's a
pnpm + Turborepo monorepo, built in numbered phases. Phases 0–1 are done (tooling, shared config,
DB, CI, plus Better Auth + multi-tenant workspaces + a TanStack Start app shell). Product features
(sequences, prospects, sending, inbox) land in Phase 2+. The phase plan lives in
`docs/implementations/phases/`.

## Commands

Run everything from the repo root with pnpm. Package-scoped scripts use `--filter @quiksend/<pkg>`.

```bash
pnpm check              # THE CI gate: lint + format + typecheck + test. Run before finishing work.
pnpm lint               # oxlint --deny-warnings
pnpm format:fix         # oxlint --fix then oxfmt --write (formatter writes last)
pnpm typecheck          # tsc --noEmit per package via Turbo
pnpm test               # vitest run (whole workspace)
pnpm build              # turbo build across packages + apps

pnpm web:dev            # run the web app → http://localhost:3000
pnpm worker:dev         # run the worker (tsx watch)

pnpm db:migrate         # apply Drizzle migrations (tsx src/migrate.ts)
pnpm db:generate        # generate a new migration from schema changes
pnpm db:studio          # Drizzle Studio
pnpm auth:generate      # regenerate packages/db/src/schema/auth.ts from the auth config
```

Run a single test file: `pnpm vitest run packages/config/src/env.test.ts` (or `pnpm vitest <pattern>`
to watch/filter).

Local infra (Postgres + Mailpit) comes from `docker compose up -d` — Postgres is `pgvector/pgvector:pg17`,
Mailpit UI at http://localhost:8025. All db/auth/app scripts load the root `.env` via `dotenv -e ../../.env`.

## Architecture

Two apps consume nine packages. All cross-package imports go through `@quiksend/*` names, never
relative paths across package boundaries.

- **`packages/config`** — the foundation. `env.ts` eagerly parses `process.env` against a Zod schema
  (`env.schema.ts`) and **calls `process.exit(1)` at import time** if anything is missing/malformed.
  Everything downstream imports `env` and can assume it's valid. Also exports a pino `logger`. The
  schema is side-effect-free and separately unit-tested (`env.test.ts`).
- **`packages/db`** — Drizzle + `postgres-js`. `client.ts` builds the single long-lived `db` client
  (`casing: "snake_case"`). Schema is in `src/schema/`: `auth.ts` is **generated** (do not hand-edit),
  `index.ts` holds domain tables. Migrations run via `src/migrate.ts`. `tenancy-guard.test.ts` is a
  regex-based CI guard that fails when an app-scoped table is queried without an `organizationId`
  filter — flip tables on in `APP_SCOPED_TABLES` as each phase lands.
- **`packages/auth`** — the single Better Auth server instance (`auth`) shared by web (and later the
  public API), plus the browser client (`@quiksend/auth/client`). Plugins: `organization` (an org **is**
  a workspace — this is how multi-tenancy works), `apiKey`, and `tanstackStartCookies` which **must stay
  last**. Social providers (Google/Microsoft) auto-wire only if their env vars are set.
- **`packages/core`** — PURE domain logic, no I/O. Owns the enrollment state machine (`transition`
  → `nextState + effects[]`) and the schedule/window/throttle math (`computeSchedule`). Imported by
  both the sequence-builder preview (Phase 5) and the worker executor (Phase 6) so preview never
  drifts from reality. Also exports branded `OrganizationId`/`UserId` types + `OrgContext`.
- **`packages/mail`** — `MailboxAdapter` interface + MIME builder + threading + compliance
  (`List-Unsubscribe` + physical-address footer). Adapter implementations (Gmail/Graph/SMTP) land in
  Phase 4; `adapters/fake.ts` ships now for unit tests.
- **`packages/integrations`** — Nango client wrapper, HMAC webhook verifier, and per-CRM config
  (`salesforce`/`hubspot` — nango integration id, sync model names, default field mapping). Rest of
  the app never imports `@nangohq/node` directly.
- **`packages/queue`** — pg-boss wrapper + typed job registry. Named payload interfaces per job
  (`SequenceStepPayload`, `CrmSyncPayload`, ...) + Zod schema for runtime validation. `enqueue()`
  producers on both apps; `registerHandler()` consumers only on the worker.
- **`packages/observability`** — Sentry + PostHog wiring. Both no-op when their env vars are unset
  so local dev needs no accounts.
- **`apps/web`** — TanStack Start (Vite + React). File-based routes in `src/routes/`. `api/auth/$.ts`
  forwards GET/POST to `auth.handler`. `_protected.tsx` gates routes via a `beforeLoad` session check.
  Session is read through a **server function** (`src/lib/auth.functions.ts`, `createServerFn`), not a
  direct client call. **All data-touching server fns compose `authMiddleware`** (`src/lib/org-fn.ts`)
  which injects `{ userId, organizationId, role }` and is THE tenancy chokepoint. UI lives in
  `src/components` (shadcn/ui in `components/ui`) — intentionally **not** a separate `packages/ui`
  until a second app needs it.
- **`apps/worker`** — long-running background process. Boots pg-boss, registers job handlers,
  handles SIGINT/SIGTERM. Real handlers (`sequence.tick`, `sequence.step`, `mailbox.poll`,
  `crm.sync`, `crm.writeback`, `webhook.deliver`, `ai.research`) land per phase; `hello.ping` runs
  in dev as a smoke test.

The auth-schema loop, when you change auth plugins/options: `pnpm auth:generate` (rewrites
`packages/db/src/schema/auth.ts`) → `pnpm db:generate` (new migration for the delta) → `pnpm db:migrate`.

## Conventions

- **Explicit `.ts`/`.tsx` extensions in relative imports** (e.g. `import ... from "./schema/index.ts"`).
  This is required — tsconfig sets `allowImportingTsExtensions` + `verbatimModuleSyntax` + `isolatedModules`.
  Use `import type` for type-only imports.
- **Oxlint owns correctness, Oxfmt owns all formatting** — they don't overlap, so don't fight them; run
  `pnpm format:fix`. Both are **exact-pinned** in `package.json` (Oxc iterates fast); don't bump casually.
- `apps/web/src/routeTree.gen.ts` is generated but **committed** (so `pnpm check` works on a fresh clone)
  and excluded from lint/format. Don't hand-edit it.
- Path alias `@/*` → `apps/web/src/*` (web app only).
- Node is pinned to `.nvmrc` (24.18.0); pnpm version is pinned via `packageManager`.

## Releases

The **whole app** is versioned as one unit by Release Please + Conventional Commits — never bump a
version or edit `CHANGELOG.md` by hand. PR **titles** must be conventional (`feat:`, `fix:`, etc.;
enforced by the `lint-pr` workflow) and merged with **Squash & merge**. Merging the standing
`chore(main): release X.Y.Z` PR cuts the release (tag + GitHub Release + GHCR images). Full details in
`RELEASING.md`.
