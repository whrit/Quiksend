# PHASE-9: CRM write-back + analytics dashboards — Track L

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-9-writeback-analytics` from `main` (worktree isolated).

## Context

Read at repo root first:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` files (root + wave4)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` section "Phase 9"
4. `packages/integrations/src/nango.ts` — Nango proxy for write-back
5. `packages/integrations/src/providers/{salesforce,hubspot}.ts` — provider config

Phase 3 landed inbound CRM sync. Phase 9 is the outbound half: log activity,
upsert contacts, write status on key events. Plus dashboards from
enrollment/message tables.

## Documentation lookup (mandatory)

Context7 MCP for:

- Salesforce REST API: Task object create endpoint, upsert on Contact via
  `/services/data/v58.0/sobjects/Contact/Email/<email>`
- HubSpot API v3: Engagement create, Contact upsert by email
- **@nangohq/node** — `nango.proxy()` POST/PATCH, error handling
- **Recharts** or **Tremor** — pick one for dashboards (Recharts is lighter);
  verify current API via Context7

## Tasks

### T1 — Schema (`packages/db/src/schema/writeback.ts`)

- **`crm_writeback_log`** — id (uuid pk), organization_id (text FK cascade),
  crm_connection_id (uuid FK → crm_connection.id set null),
  event_type pg enum ('activity_log', 'contact_upsert', 'status_update'),
  entity_type text ('message' | 'enrollment' | 'prospect'),
  entity_id uuid notNull,
  crm_external_id text nullable (populated after successful write),
  idempotency_key text notNull UNIQUE,
  status pg enum ('pending', 'succeeded', 'failed') default 'pending',
  attempts int default 0, last_error text nullable, last_attempted_at timestamptz nullable,
  payload jsonb (what we sent), response jsonb nullable,
  timestamps.
  Index `(organization_id, entity_type, entity_id)`.

- **`event`** — id (uuid pk), organization_id, type text notNull
  (`message.sent` | `reply.received` | `enrollment.completed` | `bounce.received`
  | `prospect.unsubscribed` | `ai.generated`), entity_type, entity_id,
  payload jsonb, created_at.
  Index `(organization_id, type, created_at DESC)` for feeds/analytics.

- **`sequence_stats`** rollup view or table (see T4).

### T2 — Write-back handlers (`packages/integrations/src/writeback/`)

- `salesforce.ts` — `logSalesforceTask(nango, connectionId, contactId, {subject, description, activityDate})` + `upsertSalesforceContact(nango, connectionId, {email, firstName, lastName, ...})` + `updateSalesforceStatus(nango, connectionId, contactId, {field, value})`
- `hubspot.ts` — analogous
- Both idempotent — check `crm_writeback_log.idempotency_key` before hitting the
  provider; on success, store `crm_external_id` in the log.

### T3 — Engine event hooks

Track G's executor emits events via `emit_event` effect. Extend the effect
interpreter (touch `apps/worker/src/sequence/execute-effects.ts` — MINIMAL,
additive) to also:

- On `message.sent` → enqueue `crm.writeback` with `event_type: 'activity_log'`
- On `reply.received` → enqueue `crm.writeback` with same
- On `enrollment.completed`/`replied`/`bounced` → enqueue `crm.writeback` with
  `event_type: 'status_update'`
- Always insert into `event` table for analytics

Also from Phase 7's inbound handler — same pattern for replies/bounces.

### T4 — Analytics (`apps/web/src/lib/analytics.functions.ts`)

Server fns computing via SQL aggregates over enrollment + message + event:

- `getSequenceFunnel({ sequenceId })` — enrolled → sent → replied → bounced → completed counts.
- `getSequenceStepRates({ sequenceId })` — per-step send + reply + bounce.
- `getSequenceABCompare({ sequenceId })` — variant A vs B outcomes with basic
  significance framing (chi-square approximation; honest "n too small" note
  when < 100 per variant).
- `getMailboxVolume({ mailboxId, from, to })` — hourly bucketed sends + bounces
  as trend.
- `getWorkspaceOverview()` — org-level: active sequences, replies this week,
  bounce rate, active enrollments.

Start with raw SQL views for now:

```sql
CREATE VIEW sequence_stats AS SELECT ...
```

Track L may also add a `sequence_stats` table + a scheduled `analytics.rollup`
job (via pg-boss) if the views get slow — Phase 9 leaves this as a follow-up
note.

### T5 — Dashboards

- `apps/web/src/routes/_protected/analytics/index.tsx` — workspace overview:
  key counters + last 30 days chart.
- `apps/web/src/routes/_protected/sequences/$id/analytics.tsx` — funnel +
  step rates + A/B compare + timeline.
- `apps/web/src/routes/_protected/settings/mailboxes/$id/health.tsx` — mailbox
  volume trend + bounce rate + cap utilization.
- Extend prospect detail timeline to show CRM writeback status (which activities
  logged, any failures).

### T6 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase9_writeback_analytics
pnpm db:migrate
pnpm check   # green
```

Manual smoke:

- Send an email from an enrolled prospect with a connected CRM.
- Verify `crm_writeback_log` row + Task/Engagement appears in CRM UI.
- Reply to the email → verify status write-back triggers.
- Load analytics dashboards; verify counts match expected values.
- Replay a `crm.writeback` job manually — verify idempotency (no duplicate Task).

## Constraints

- **Touch ONLY**:
  - `packages/db/src/schema/writeback.ts` (new)
  - `packages/db/src/schema/index.ts` (add exports)
  - `packages/db/src/tenancy-guard.test.ts` + testing.ts
  - `packages/integrations/src/writeback/**` (new)
  - `apps/worker/src/sequence/execute-effects.ts` (extend, minimal-additive)
  - `apps/worker/src/handlers/crm-writeback.ts` (new — handles `crm.writeback` job)
  - `apps/worker/src/handlers/inbound-writeback.ts` (new — Phase 7 hook)
  - `apps/web/src/lib/analytics.functions.ts` (new)
  - `apps/web/src/routes/_protected/analytics/**` (new)
  - `apps/web/src/routes/_protected/sequences/$id/analytics.tsx` (new)
  - `apps/web/src/routes/_protected/settings/mailboxes/$id/health.tsx` (new)
- **DO NOT** modify Phase 3's `crm.functions.ts` unless MINIMAL addition needed
- Context7 MCP for SF REST API, HubSpot v3, Recharts/Tremor

## Result

```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/writeback.ts", "..."],
  "notes": "Phase 9 complete. pnpm check green. Idempotent writeback via crm_writeback_log.idempotency_key. Dashboards from SQL views over enrollment/message/event; A/B compare with honest n-too-small notes. Rollup tables deferred until views measurably slow."
}
```
