# Quiksend

Open-source, self-hostable sales engagement platform — AI-personalized email sequences
with first-class Salesforce/HubSpot operations. An alternative to Outreach.io and
Salesforge.ai.

> **Phases 0–1 built.** The monorepo foundation (tooling, shared config, database, CI)
> plus **auth & workspaces**: Better Auth (email/password + Google/Microsoft), the
> `organization` plugin as multi-tenant workspaces, an `apiKey` plugin for the future
> public API, and a TanStack Start app shell (login, protected dashboard, workspace
> switcher). Product features (sequences, prospects, sending, inbox) land in Phases 2+.

## Stack

TypeScript · pnpm workspaces · Turborepo · TanStack Start · Better Auth · PostgreSQL +
Drizzle · Tailwind v4 + shadcn/ui · Nango.dev (Phase 3) · Oxlint + Oxfmt.

## Prerequisites

- **Node** — version pinned in `.nvmrc` (22.18+). `nvm use` or `fnm use`.
- **pnpm** — `corepack enable` (the version is pinned via `packageManager`).
- **Docker** — for local Postgres + Mailpit.

## Quickstart

```bash
# 1. install
pnpm install

# 2. env — set a real BETTER_AUTH_SECRET (openssl rand -base64 32)
cp .env.example .env

# 3. infra (Postgres + Mailpit)
docker compose up -d

# 4. database: apply migrations (auth tables land in 0001)
pnpm db:migrate

# 5. verify the whole gate
pnpm check

# 6. run the web app, then open http://localhost:3000
pnpm web:dev
```

Mailpit UI: <http://localhost:8025>. Drizzle Studio: `pnpm db:studio`.

## Self-host quickstart (production overlay)

For a full stack (Postgres + Mailpit + web + worker):

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET, UNSUBSCRIBE_TOKEN_SECRET, WEBHOOK_SIGNING_SECRET
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
pnpm db:migrate
pnpm db:seed             # optional demo data
```

Public API docs: [docs/api.md](./docs/api.md) · Webhook signing: [docs/webhooks.md](./docs/webhooks.md) · OpenAPI: `GET /api/v1/openapi.json`

Create API keys and webhooks under **Settings → API keys** / **Settings → Webhooks** in the UI.

## Auth & workspaces (Phase 1)

- `packages/auth` owns the Better Auth server instance (`auth`) and the browser client
  (`@quiksend/auth/client`). Plugins: `organization` (→ workspaces), `apiKey`, and
  `tanstackStartCookies` (kept last so cookie handling works with Start).
- Auth tables live in `packages/db/src/schema/auth.ts`. They're **generated** from the
  auth config — regenerate after changing plugins/options:

  ```bash
  pnpm auth:generate        # writes packages/db/src/schema/auth.ts
  pnpm db:generate          # new Drizzle migration for the delta
  pnpm db:migrate
  ```

- Social login is optional: leave the `GOOGLE_*` / `MS_*` vars blank and those buttons
  simply don't wire up.
- **UI lives in `apps/web/src/components`, not a separate `packages/ui`.** With one
  consumer that's the lower-friction choice (shared Tailwind config, no cross-package
  build step); extract to `packages/ui` when a second app needs the components.

## Scripts (root)

| Script                                                      | What it does                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm lint`                                                 | Oxlint over the whole tree (`--deny-warnings`)               |
| `pnpm lint:fix`                                             | Oxlint autofix                                               |
| `pnpm format`                                               | Oxfmt check                                                  |
| `pnpm format:fix`                                           | Oxlint fix, then Oxfmt write (formatter is the last writer)  |
| `pnpm typecheck`                                            | `tsc --noEmit` per package via Turbo                         |
| `pnpm test`                                                 | Vitest across the workspace                                  |
| `pnpm check`                                                | lint + format + typecheck + test (the CI gate)               |
| `pnpm build`                                                | Build all packages + apps via Turbo                          |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle Kit (loads root `.env`)                              |
| `pnpm db:seed`                                              | Demo workspace + prospects + sequence (self-host onboarding) |
| `pnpm auth:generate`                                        | Regenerate the Better Auth Drizzle schema                    |
| `pnpm web:dev` / `web:build`                                | Run / build the TanStack Start app                           |
| `pnpm worker:dev`                                           | Run the worker with watch                                    |

## Structure

```
apps/
  web/        TanStack Start app — routes, server fns, auth handler, UI  ← Phase 1
  worker/     scheduler, senders, pollers, sync runners                  ← core from Phase 6
packages/
  auth/       Better Auth server instance + browser client               ← Phase 1
  config/     zod-validated env + pino logger
  db/         Drizzle schema (incl. generated auth tables), client, migrations
```

## Tooling notes

- **Oxlint + Oxfmt** are pinned exactly (`package.json`), since Oxc iterates quickly and
  format output can shift between releases. Configs: `oxlint.config.ts`, `oxfmt.config.ts`.
- Oxlint stays on correctness/logic; **Oxfmt owns all formatting** — they don't fight.
- The generated `apps/web/src/routeTree.gen.ts` is **committed** (so `pnpm check` works on
  a fresh clone) but excluded from lint/format.
- Install the **Oxc** editor extension (see `.vscode/extensions.json`) for format-on-save
  matching the CLI.

## License

[AGPL-3.0](./LICENSE). A CLA (to preserve dual-licensing / commercial options) and a
trademark on the name are planned separately — a license file alone doesn't cover those.
