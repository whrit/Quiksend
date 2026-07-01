# Quiksend

Open-source, self-hostable cold email platform — AI-personalized email sequences
with Salesforce/HubSpot operations. An alternative to Outreach.io and
Salesforge.ai.

## Stack

TypeScript · pnpm workspaces · Turborepo · TanStack Start (Phase 1) · Better Auth (Phase 1) ·
Nango.dev (Phase 3) · PostgreSQL + Drizzle · Oxlint + Oxfmt.

## Prerequisites

- **Node** — version pinned in `.nvmrc` (22.18+). `nvm use` or `fnm use`.
- **pnpm** — `corepack enable` (the version is pinned via `packageManager`).
- **Docker** — for local Postgres + Mailpit.

## Quickstart

```bash
# 1. install
pnpm install

# 2. env
cp .env.example .env

# 3. infra (Postgres + Mailpit)
docker compose up -d

# 4. database: generate the first migration from the schema, then apply it
pnpm db:generate
pnpm db:migrate

# 5. verify the whole gate
pnpm check

# 6. run the worker (boots, validates env, pings the DB, idles)
pnpm worker:dev
```

Mailpit UI: <http://localhost:8025>. Drizzle Studio: `pnpm db:studio`.

## Scripts (root)

| Script                                                      | What it does                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint`                                                 | Oxlint over the whole tree (`--deny-warnings`)              |
| `pnpm lint:fix`                                             | Oxlint autofix                                              |
| `pnpm format`                                               | Oxfmt check                                                 |
| `pnpm format:fix`                                           | Oxlint fix, then Oxfmt write (formatter is the last writer) |
| `pnpm typecheck`                                            | `tsc --noEmit` per package via Turbo                        |
| `pnpm test`                                                 | Vitest across the workspace                                 |
| `pnpm check`                                                | lint + format + typecheck + test (the CI gate)              |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle Kit (loads root `.env`)                             |
| `pnpm worker:dev`                                           | Run the worker with watch                                   |

## Structure

```
apps/
  web/        TanStack Start app (UI + server fns + server routes)  ← Phase 1
  worker/     scheduler, senders, pollers, sync runners             ← core from Phase 6
packages/
  config/     zod-validated env + pino logger
  db/         Drizzle schema, client, migrations
```

## Tooling notes

- **Oxlint + Oxfmt** are pinned exactly (`package.json`), since Oxc iterates quickly and
  format output can shift between releases. Configs: `oxlint.config.ts`, `oxfmt.config.ts`.
- Oxlint stays on correctness/logic; **Oxfmt owns all formatting** — they don't fight.
- Install the **Oxc** editor extension (see `.vscode/extensions.json`) for format-on-save
  matching the CLI.

## License

[AGPL-3.0](./LICENSE). A CLA (to preserve dual-licensing / commercial options) and a
trademark on the name are planned separately — a license file alone doesn't cover those.
