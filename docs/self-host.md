# Self-hosting Quiksend

Production deployment uses the same Docker Compose stack as local dev, with an
optional production overlay. See the [README](../README.md) quickstart for the
baseline setup.

## Database connection modes

Quiksend uses [postgres.js](https://github.com/porsager/postgres) via
`@quiksend/db`. By default, prepared statements are enabled for direct Postgres
or session-mode pooler connections.

When fronting Postgres with a **transaction-mode pooler** (PgBouncer,
Neon pooled endpoint, Supabase pooler, etc.), prepared statements break because
connections are returned to the pool between queries. Set:

```bash
DATABASE_POOLER_MODE=transaction
```

This passes `{ prepare: false }` to postgres.js. Use a **direct** or
**session-mode** `DATABASE_URL` for long-lived worker processes when possible;
transaction pooling is fine for the web app if you split URLs per process.

## Webhook delivery tuning

Retry sweeps and worker concurrency are configurable:

| Variable                      | Default | Purpose                                                |
| ----------------------------- | ------- | ------------------------------------------------------ |
| `WEBHOOK_SWEEP_INTERVAL_MS`   | `60000` | How often the worker sweeps pending webhook deliveries |
| `WEBHOOK_SWEEP_BATCH_SIZE`    | `50`    | Max deliveries enqueued per sweep                      |
| `WEBHOOK_DELIVER_CONCURRENCY` | `5`     | Concurrent `webhook.deliver` jobs per worker process   |

Raise concurrency cautiously — each job performs an outbound HTTP POST with a
30s timeout.

## Prospect search indexes

The performance migration enables `pg_trgm` and adds GIN indexes on prospect
name/email fields and company name. ILIKE searches with leading wildcards use
these indexes automatically when the extension is present.

## Analytics event timeline

Prospect activity timelines should query the `event` table with:

```sql
WHERE organization_id = $1
  AND entity_type = 'prospect'
  AND entity_id = $2
ORDER BY created_at DESC
```

Index `event_org_entity_created_idx` supports this pattern.
