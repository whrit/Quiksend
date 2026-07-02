# Self-hosting Quiksend

## Deployment options

| Option                           | Best for                       | Notes                                                                                                                                                  |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Docker Compose** (recommended) | &lt; 100 workspaces, single VM | Postgres + web + worker from GHCR; see recipe below                                                                                                    |
| **Kubernetes / cloud VM**        | Larger scale, HA               | Run the same GHCR images; add ingress, secrets manager, and managed Postgres. No first-party Helm chart yet — treat Compose as the reference topology. |

Local development uses `docker compose up -d` (Postgres + Mailpit only) and runs
`pnpm web:dev` / `pnpm worker:dev` on the host. Production adds the app overlay.

## Prerequisites

- Postgres **17** with `vector` and `pg_trgm` extensions (included in `pgvector/pgvector:pg17`)
- Node **24.18+** and pnpm **11.9+** (for migrations from a checkout)
- **Nango Cloud** account — required for Gmail, Microsoft, Salesforce, or HubSpot OAuth
- **Anthropic** or **OpenAI** API key — required only if you use AI research/generation
- Outbound mail: SMTP relay **or** Gmail/Microsoft via Nango

## Environment variables (production)

Full list: [`.env.example`](../.env.example). Production validation (`NODE_ENV=production`)
requires all of the following in addition to `DATABASE_URL`:

| Variable                   | Required                | How to generate / set                                          |
| -------------------------- | ----------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`             | Always                  | Postgres connection string                                     |
| `BETTER_AUTH_SECRET`       | Production              | `openssl rand -base64 32` (≥ 32 bytes)                         |
| `BETTER_AUTH_URL`          | Production              | Public URL of the web app, e.g. `https://quiksend.example.com` |
| `NANGO_WEBHOOK_SECRET`     | Production              | From Nango dashboard → Environment settings                    |
| `NANGO_SECRET_KEY`         | When using integrations | From Nango dashboard                                           |
| `MAILBOX_ENCRYPTION_KEY`   | Production              | `openssl rand -base64 32` (encrypts SMTP credentials at rest)  |
| `UNSUBSCRIBE_TOKEN_SECRET` | Production              | `openssl rand -base64 32`                                      |

**Optional but recommended:**

| Variable                               | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT`    | Error tracking (web + worker)                     |
| `POSTHOG_KEY` / `POSTHOG_HOST`         | Product analytics                                 |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | AI features                                       |
| `SMTP_HOST` / `SMTP_PORT`              | Default SMTP relay when not using OAuth mailboxes |
| `DATABASE_POOLER_MODE=transaction`     | Use with PgBouncer / Neon pooled endpoints        |
| `NANGO_PUBLIC_URL`                     | Public base URL Nango redirects to after connect  |

Webhook throughput tuning: `WEBHOOK_SWEEP_INTERVAL_MS`, `WEBHOOK_SWEEP_BATCH_SIZE`,
`WEBHOOK_DELIVER_CONCURRENCY` — see [troubleshooting](./troubleshooting.md#webhook-delivery-backlog).

## Docker Compose recipe

Create `.env` from `.env.example` and set production secrets. Then:

```bash
# Start Postgres (+ Mailpit for smoke tests; remove in real prod)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Migrations — run from a checkout (GHCR web image has no pnpm)
DATABASE_URL=postgres://quiksend:CHANGE_ME@localhost:5432/quiksend pnpm db:migrate
```

`docker-compose.prod.yml` pulls:

- `ghcr.io/whrit/quiksend-web:latest`
- `ghcr.io/whrit/quiksend-worker:latest`

Override the tag to pin a release, e.g. `ghcr.io/whrit/quiksend-web:v2.1.0`.

For production SMTP, point `SMTP_HOST` / `SMTP_PORT` at your relay and remove or
disable the Mailpit service. The worker **must** run alongside web — it executes
sequences, polls mailboxes, and processes CRM sync jobs.

### Database connection modes

When fronting Postgres with a **transaction-mode pooler** (PgBouncer, Neon pooled
endpoint, Supabase pooler), set `DATABASE_POOLER_MODE=transaction`. This disables
prepared statements in postgres.js. Prefer a direct or session-mode URL for the
long-lived worker when possible.

## First-run setup

1. **Migrate** — `pnpm db:migrate` against production `DATABASE_URL` (from checkout or CI).
2. **Sign up** the first admin at `/login` (email + password).
3. **Create a workspace** — onboarding flow after first login.
4. **Configure Nango** — [docs/nango-setup.md](./nango-setup.md) (Gmail, Microsoft, CRM).
5. **Connect a mailbox** — Settings → Mailboxes → Add mailbox.
6. **Import prospects** — CSV import or CRM sync (Settings → Integrations).

API keys and webhooks: Settings → API keys / Webhooks, or see
[docs/api.md](./api.md) and [docs/webhooks.md](./webhooks.md).

## Salesforce / HubSpot setup

Follow [Nango setup](./nango-setup.md#salesforce) and
[Nango setup — HubSpot](./nango-setup.md#hubspot). In Quiksend: Settings → Integrations
→ Connect, then configure field mapping and sync schedule.

## Backups

```bash
pg_dump -Fc "$DATABASE_URL" > quiksend-$(date +%F).dump
```

Run daily (cron or managed backup). OAuth refresh tokens and SMTP credentials are
stored encrypted in `mailbox.smtp_config` (jsonb) — a full Postgres dump preserves them.

## Upgrades

1. Pull the new GHCR tag (or merge the release PR and note the version from
   [RELEASING.md](../RELEASING.md)).
2. Run migrations: `pnpm db:migrate` against production `DATABASE_URL`.
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml pull`
4. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
5. Restart the **worker** last so in-flight jobs drain cleanly.

## Common operational failures

Short fixes below; full runbooks with SQL in [troubleshooting.md](./troubleshooting.md).

| Symptom                      | Quick fix                                                                  |
| ---------------------------- | -------------------------------------------------------------------------- |
| Mailbox shows `error` status | Settings → Mailboxes — delete and reconnect OAuth, or fix SMTP credentials |
| Worker OOM / restarts        | `NODE_OPTIONS=--max-old-space-size=2048` on worker container               |
| `remaining connection slots` | PgBouncer + `DATABASE_POOLER_MODE=transaction`; scale down worker replicas |
| Slow `/prospects` search     | Confirm `pg_trgm` installed — `pnpm db:migrate`                            |

## Getting help

- GitHub issues: https://github.com/whrit/Quiksend/issues
- Architecture: [architecture.md](./architecture.md)
- Nango: [nango-setup.md](./nango-setup.md)
