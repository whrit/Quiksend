# Troubleshooting

Operational runbooks for self-hosted Quiksend. Each section: **Symptoms → Diagnosis → Fix**.

---

## Mailbox OAuth or SMTP failure

### Symptoms

- Mailbox `status` is `error` in Settings → Mailboxes
- Sequence steps fail with send errors in worker logs
- Gmail/Microsoft: 401 from Nango proxy; SMTP: connection or auth refused

### Diagnosis

```sql
-- Mailboxes in error state for an org
SELECT id, address, provider, status, updated_at
FROM mailbox
WHERE organization_id = '<org-id>'
  AND status = 'error';

-- Recent failed outbound messages
SELECT id, mailbox_id, status, error, created_at
FROM message
WHERE organization_id = '<org-id>'
  AND direction = 'outbound'
  AND status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

Check worker logs for `SendError` or Nango proxy failures. For OAuth, verify Nango
connection exists in the Nango dashboard for the workspace's connection ID stored in
`mailbox.smtp_config`.

### Fix

1. **OAuth (Gmail / Microsoft):** Settings → Mailboxes → delete the mailbox → Add mailbox
   → reconnect via Nango Connect UI. Confirm [nango-setup.md](./nango-setup.md) scopes
   and redirect URI `https://api.nango.dev/oauth/callback` on the provider app.
2. **SMTP:** Verify `MAILBOX_ENCRYPTION_KEY` has not changed since the mailbox was created
   (rotating the key invalidates stored credentials). Update host/port/auth and test send.
3. Set mailbox back to active after fix:

   ```sql
   UPDATE mailbox SET status = 'active', updated_at = now()
   WHERE id = '<mailbox-id>' AND organization_id = '<org-id>';
   ```

---

## Worker OOM or crash loop

### Symptoms

- Worker container restarts repeatedly in `docker compose ps`
- Enrollments stuck with `next_run_at` in the past
- `JavaScript heap out of memory` in logs

### Diagnosis

```sql
-- Stale active enrollments (scheduler should have picked these up)
SELECT count(*) AS stuck
FROM enrollment
WHERE state IN ('active', 'waiting', 'waiting_manual')
  AND next_run_at < now() - interval '15 minutes';

-- Per-org breakdown
SELECT organization_id, count(*) AS stuck
FROM enrollment
WHERE state IN ('active', 'waiting', 'waiting_manual')
  AND next_run_at < now() - interval '15 minutes'
GROUP BY organization_id;
```

```bash
docker compose logs worker --tail 200
```

### Fix

1. Raise Node heap on the worker service:

   ```yaml
   environment:
     NODE_OPTIONS: --max-old-space-size=2048
   ```

2. Ensure only **one** worker leader runs sequence ticks per deployment (multiple
   workers are supported for job handlers, but duplicate schedulers increase load).
3. If running the load-test harness in production, reduce batch size in
   `packages/db/src/load-test-scheduler.ts` — do not run load tests against prod.
4. Restart worker after memory change: `docker compose restart worker`

---

## Database connection limit

### Symptoms

- `remaining connection slots are reserved for roles with the SUPERUSER attribute`
- Intermittent 500s on web; worker fails `select 1` on boot

### Diagnosis

```sql
SELECT count(*) AS total, state
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state;
```

Compare to `max_connections` (`SHOW max_connections;`). Each web replica and worker
opens a pool via postgres.js.

### Fix

1. Front Postgres with **PgBouncer** (transaction mode) and set:

   ```bash
   DATABASE_POOLER_MODE=transaction
   ```

2. Use a **session-mode** or direct URL for the worker if transaction pooling causes
   issues with long jobs.
3. Reduce duplicate worker/web replicas until connections stabilize.
4. Tune webhook concurrency down: `WEBHOOK_DELIVER_CONCURRENCY=3`

---

## High latency on prospect list

### Symptoms

- `/prospects` or prospect search UI slow (&gt; 2s)
- `EXPLAIN ANALYZE` shows sequential scan on `prospect` or `company`

### Diagnosis

```sql
-- Extension present?
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';

-- Example search plan (replace org id)
EXPLAIN ANALYZE
SELECT id, email, first_name, last_name
FROM prospect
WHERE organization_id = '<org-id>'
  AND email ILIKE '%example%'
LIMIT 50;
```

Expect a **Bitmap Index Scan** on a GIN index when `pg_trgm` and migration
`0014_wave5_epsilon_perf_indexes` are applied.

### Fix

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Then run `pnpm db:migrate` from a checkout. Re-test `EXPLAIN ANALYZE`.

---

## Webhook delivery backlog

### Symptoms

- Webhook deliveries stuck in `pending` or retrying for hours
- Customer endpoints not receiving events

### Diagnosis

```sql
SELECT status, count(*)
FROM webhook_delivery
WHERE organization_id = '<org-id>'
GROUP BY status;

SELECT id, endpoint_id, status, attempt_count, next_attempt_at, last_error
FROM webhook_delivery
WHERE status IN ('pending', 'retrying')
ORDER BY created_at DESC
LIMIT 20;
```

### Fix

Tune env vars (defaults in `packages/config/src/env.schema.ts`):

| Variable                      | Default | Action                         |
| ----------------------------- | ------- | ------------------------------ |
| `WEBHOOK_SWEEP_INTERVAL_MS`   | 60000   | Lower for faster sweep         |
| `WEBHOOK_SWEEP_BATCH_SIZE`    | 50      | Raise cautiously               |
| `WEBHOOK_DELIVER_CONCURRENCY` | 5       | Raise if endpoints are healthy |

Restart worker after changes. Verify endpoint URLs return 2xx and HMAC validation
matches [webhooks.md](./webhooks.md).

---

## CRM sync idle or error

### Symptoms

- Settings → Integrations shows `error` or stale `last_sync_at`
- Prospects not updating from Salesforce/HubSpot

### Diagnosis

```sql
SELECT id, provider, status, last_run_at, last_error
FROM crm_connection
WHERE organization_id = '<org-id>';
```

Check Nango dashboard for connection health and sync status.

### Fix

1. Re-authorize in Settings → Integrations (Nango Connect UI).
2. Confirm `NANGO_WEBHOOK_SECRET` and webhook URL `/api/nango/webhook`.
3. Clear error and trigger sync:

   ```sql
   UPDATE crm_connection
   SET status = 'idle', last_error = null
   WHERE organization_id = '<org-id>' AND provider = 'salesforce';
   ```

   (Enqueue `crm.sync` from UI or wait for scheduled tick.)

---

## Sequence not sending

### Symptoms

- Enrollments `active` but no outbound messages
- Mailpit empty in local dev

### Diagnosis

```sql
SELECT e.id, e.state, e.next_run_at, e.current_step_index, s.status AS sequence_status
FROM enrollment e
JOIN sequence s ON s.id = e.sequence_id
WHERE e.organization_id = '<org-id>'
ORDER BY e.updated_at DESC
LIMIT 20;
```

```bash
# Worker must be running
pnpm worker:dev   # local
docker compose logs worker   # production
```

### Fix

1. Start the **worker** — web alone does not execute sequence steps.
2. Sequence must be `active`; mailbox `active` and listed in sequence `settings.mailbox_ids`.
3. Check suppression and daily caps on mailbox.
4. For local demo: SMTP mailbox → `localhost:1025` (Mailpit), view http://localhost:8025.

---

## Getting more help

- [self-host.md](./self-host.md) — deployment and upgrades
- [nango-setup.md](./nango-setup.md) — OAuth provider configuration
- https://github.com/whrit/Quiksend/issues
