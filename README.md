# Quiksend

Open-source, self-hosted sales engagement platform — AI-personalized email sequences
with Salesforce and HubSpot writeback.

## Why Quiksend

Outreach.io and Salesforge.ai are powerful, but they are closed SaaS: your data,
credentials, and sending reputation live on someone else's infrastructure. Quiksend
is AGPL-licensed, self-hostable, and source-visible — you run the app, Postgres, and
worker on your own terms.

CRM connectivity goes through [Nango](https://nango.dev), which covers 250+ providers
(Salesforce, HubSpot, Gmail, Microsoft Graph, and more) behind one OAuth and sync
layer. Sequences are manual-first with optional AI generation grounded in web research
and CRM context, so reps stay in control while automation handles follow-up.

## Get started

> **New to Node / Docker / self-hosting a dev environment?** Follow the full
> [Getting started guide](docs/getting-started.md) — beginner-friendly, ~20 minutes
> from git clone to sending your first email locally.

**Already comfortable?** Quick path:

### Prerequisites

- **Node** 24.18+ (see `.nvmrc`) and **pnpm** 11.9+ (`corepack enable`)
- **Docker** + **Docker Compose** (local Postgres + Mailpit)
- _(Optional)_ [Nango Cloud](https://nango.dev) account for Gmail / Microsoft OAuth mailboxes
- _(Optional)_ Anthropic or OpenAI API key for AI-personalized email generation

### 5-minute local demo

```bash
# 1. Clone and install
git clone https://github.com/whrit/Quiksend.git
cd Quiksend
pnpm install

# 2. Environment — generate a secret: openssl rand -base64 32
cp .env.example .env
# Set BETTER_AUTH_SECRET in .env (required for the web app)

# 3. Infra (Postgres + Mailpit)
docker compose up -d

# 4. Database
pnpm db:migrate

# 5. (Optional) Demo data — see note below
pnpm db:seed

# 6. Start the app and worker (two terminals)
pnpm web:dev          # → http://localhost:3000
pnpm worker:dev       # required for sequences, CRM sync, and inbound polling
```

7. Open http://localhost:3000 → **Sign up** at `/login` (Create account).
8. Complete **onboarding** to create your workspace.
9. **Settings → Mailboxes → Add mailbox** — choose SMTP with host `localhost`, port `1025`
   (Mailpit defaults). Enroll prospects in a sequence; outbound mail appears in
   [Mailpit](http://localhost:8025).

> **Seed note:** `pnpm db:seed` inserts a demo workspace (mailbox, sequence, 20 prospects)
> but does not set a login password for `demo@quiksend.local`. Use your own account for
> the UI demo.

Drizzle Studio: `pnpm db:studio`. CI gate for contributors: `pnpm check`.

### Self-hosting

See [docs/self-host.md](docs/self-host.md) for production deployment with Docker Compose
and GHCR images.

## Features

- Manual-first sequences → automated follow-up (Gmail, Microsoft 365, SMTP)
- **Enterprise deliverability** — SEG detection (Proofpoint / Mimecast / Barracuda / Cisco), routing around consumer ESPs, real-time canary drop detection. See [docs/deliverability.md](docs/deliverability.md).
- AI research + generation grounded in web and CRM context
- Salesforce + HubSpot bi-directional sync via Nango
- Unified inbox with sentiment classification
- Public REST API + outbound webhooks — [docs/api.md](docs/api.md), [docs/webhooks.md](docs/webhooks.md)
- Multi-tenant workspaces from day one (Better Auth `organization` plugin)

## Architecture

```
Browser → apps/web (TanStack Start) → Postgres
                    ↓ enqueue              ↑
              pg-boss queue ← apps/worker → Nango → Gmail / Microsoft / CRMs
```

Details: [docs/architecture.md](docs/architecture.md). Contributor conventions:
[CLAUDE.md](./CLAUDE.md).

## Contributing

- Read [CLAUDE.md](./CLAUDE.md) for monorepo layout, scripts, and conventions.
- Run `pnpm check` before opening a PR (lint + format + typecheck + test).
- Releases are automated — see [RELEASING.md](./RELEASING.md). PR titles must use
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …).

## License

[AGPL-3.0](./LICENSE)
