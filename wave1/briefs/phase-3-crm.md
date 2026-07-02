# PHASE-3: Nango + CRM Sync — Track C

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-3-crm-sync` from `main` (worktree, isolated).

## Context

Read at repo root first, in order:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (critical — Track 2 pre-bakes CRM columns on `prospect`/`company`;
   you populate them, you do NOT alter their schema)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` sections
   "Cross-cutting conventions" and "Phase 3 — Nango wiring + inbound CRM sync"
4. `packages/integrations/src/index.ts` and `packages/integrations/src/providers/**`
   — the Nango wrapper + provider config landed in foundations (v1.1.0). You
   BUILD ON THIS, don't rewrite it.

The pg-boss queue is up (`packages/queue`) — you register a handler in
`apps/worker/src/handlers/crm-sync.ts`. Nango Cloud was chosen (env var
`NANGO_SECRET_KEY`); webhook signature verifier lives in
`packages/integrations/src/webhook.ts`.

## Documentation lookup (mandatory)

Fetch via Context7 MCP before writing any of these:

- **`@nangohq/node`** — `Nango.createConnectSession`, `nango.get`/`.post`/`.proxy`,
  `listRecords` / records API for scripted syncs, webhook payload shape
- **`@nangohq/frontend`** — `openConnectUI({onEvent})` + `setSessionToken`
- **Drizzle ORM** — schema, `on conflict do update`, `sql` template for FK add-ons
- **TanStack Start** — `createFileRoute('/api/nango/webhook')({server:{handlers:{POST}}})`
- **Better Auth** — `authClient.getSession().data.session.activeOrganizationId`
  on the frontend if you need to gate connect UI to admins
- **pg-boss** v12 — `send()`, `work()` handler signature (already wrapped by
  `packages/queue`; use `enqueue()` / `registerHandler()`)

## Tasks (in order)

### T1 — Schema (`packages/db/src/schema/crm.ts`)

- **`crm_connection`** — id (uuid pk), organization_id (text FK → `organization.id`
  cascade), provider pg enum ('salesforce', 'hubspot') notNull,
  nango_connection_id (text notNull, unique per (org, provider)),
  status text default 'active' ('active' | 'error' | 'disconnected'),
  field_mapping (jsonb notNull — default `{}`), last_sync_at (timestamptz nullable),
  last_error (text nullable), created_by_user_id (text FK → user.id),
  timestamps.
  Indexes: `(organization_id, provider)` unique.
- **`sync_state`** — id (uuid pk), organization_id (text FK cascade),
  connection_id (uuid FK → `crm_connection.id` cascade), model text notNull
  ('Contact' | 'Account' | 'Company' — provider-specific), cursor (jsonb —
  provider-specific checkpoint, e.g. `{ lastModifiedISO }`),
  last_run_at (timestamptz nullable), status text default 'idle' ('idle' |
  'running' | 'error'), error text nullable, timestamps.
  Unique `(connection_id, model)`.

**Add the FK Track 2 deferred:**
Because Track 2 pre-baked `prospect.crm_connection_id` and `company.crm_connection_id`
as nullable uuid WITHOUT the FK, you add the FK now in this migration:

```sql
ALTER TABLE prospect ADD CONSTRAINT prospect_crm_connection_id_fkey
  FOREIGN KEY (crm_connection_id) REFERENCES crm_connection(id) ON DELETE SET NULL;
ALTER TABLE company ADD CONSTRAINT company_crm_connection_id_fkey
  FOREIGN KEY (crm_connection_id) REFERENCES crm_connection(id) ON DELETE SET NULL;
```

Express this in the Drizzle schema by declaring the FK reference on the columns
in `prospects.ts`. Since you don't own `prospects.ts`, do NOT edit that file
directly — instead include a **post-migration SQL step** (Drizzle-generated
migration + your manual addition via a follow-up statement or a separate migration
file `0004_crm_fks.sql` that you author by hand and place in `packages/db/drizzle/`).
Update the drizzle `_journal.json` to include the entry.
**If this is too surgical**, alternative acceptable: keep the columns FK-less at
the DB level for Wave 1 and note it — Phase 3's referential integrity is enforced
at the application layer via the tenancy chokepoint. Choose the simpler path and
document it in RESULT.notes.

Barrel export from `packages/db/src/schema/index.ts`:

```ts
export * from "./crm.ts";
```

### T2 — Activate tenancy guard

Add `crm_connection`, `sync_state` to `APP_SCOPED_TABLES` in `packages/db/src/tenancy-guard.test.ts`.
Add to `APP_SCOPED_TABLES_TO_TRUNCATE` in `packages/db/src/testing.ts` (before
`prospect`/`company` if you're the second migration, since FKs reference us).

### T3 — Migration

`pnpm db:generate --name phase3_crm_connection` → review → `pnpm db:migrate`.

### T4 — Integrations sync layer (`packages/integrations/src/sync/`)

Create three files:

- `index.ts` — barrel
- `types.ts` — shared types:
  ```ts
  export interface NormalizedContact {
    externalId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    companyExternalId: string | null;
    lastModifiedISO: string;
  }
  export interface NormalizedAccount {
    externalId: string;
    name: string | null;
    domain: string | null;
    industry: string | null;
    size: number | null;
    website: string | null;
    lastModifiedISO: string;
  }
  export interface SyncPage<T> {
    records: T[];
    nextCursor: string | null;
  }
  ```
- `fetch-changed-records.ts` — one exported function per provider/model:
  ```ts
  export async function fetchChangedSalesforceContacts(
    connectionId: string,
    sinceCursor: string | null,
  ): Promise<SyncPage<NormalizedContact>>;
  ```
  and the same for hubspot + accounts. Use `getNango()` from
  `packages/integrations/src/nango.ts`. Pull via Nango's records API OR proxy
  (whichever the current Nango Node SDK exposes — verify via Context7). Map raw
  provider fields → `Normalized*` using the field mapping stored on the
  `crm_connection.field_mapping`. Handle pagination via the provider's cursor
  (Salesforce `nextRecordsUrl`, HubSpot `paging.next.after`).

### T5 — Upsert helpers (`packages/integrations/src/sync/upsert.ts`)

Pure functions the worker calls after fetching. Take the normalized records

- an `orgId` + `connectionId`, and upsert into `prospect`/`company` tables using
  Drizzle's `insert ... onConflictDoUpdate`. Dedupe rules (per WAVE_CONTEXT.md):

* **Contact upsert** — match on `(organization_id, crm_provider, crm_external_id)`
  first; if not found, match on `(organization_id, email)`; if not found, insert.
  When matching on email, ATTACH `crm_provider`/`crm_external_id`/`crm_connection_id`
  to the existing row.
* **Company upsert** — match on `(organization_id, crm_provider, crm_external_id)`;
  if not found, match on `(organization_id, domain)`; if not found, insert.
* **Precedence**: CRM fields (name, email, title, etc.) win on next sync for
  rows that are CRM-owned (`crm_external_id IS NOT NULL`), unless the row's
  `updated_at > last_crm_sync_at + 1h` in which case local edits win. Encode as
  `set = crm_provider IS NOT NULL AND (updated_at IS NULL OR updated_at < last_crm_sync_at + interval '1 hour')`.
* Update `last_crm_sync_at` on every touch.
* Link contacts to companies: after upsert, if a contact carries a
  `companyExternalId`, look up the company row (same org, same connection,
  matching external id) and set `prospect.company_id`.

Unit-test the upsert functions in `packages/integrations/src/sync/upsert.test.ts`
with an in-memory Drizzle mock or a scoped Postgres integration test using the
`testing.ts` harness — cover: first-sync insert, second-sync update, matched-by-email
attach, local-edit wins, company link.

### T6 — Worker handler (`apps/worker/src/handlers/crm-sync.ts`)

Register a `crm.sync` handler using `registerHandler` from `@quiksend/queue`:

```ts
await registerHandler("crm.sync", async ({ connectionId, model }) => { ... });
```

Handler flow:

1. Load `crm_connection` + `sync_state` for (connection, model)
2. Loop `while cursor exists`:
   - Fetch page via `fetch-changed-records.ts`
   - Upsert
   - Save new cursor to `sync_state`, commit
3. Update `crm_connection.last_sync_at` + `sync_state.last_run_at`
4. Log via pino (`@quiksend/config` logger) with `{ organizationId, connectionId, model, page }`

Wire this into `apps/worker/src/index.ts` (add one `await registerHandler(...)`
line after the existing `hello.ping` registration).

### T7 — Web routes

- `apps/web/src/routes/api/nango/webhook.ts` — server route:

  ```ts
  export const Route = createFileRoute("/api/nango/webhook")({
    server: { handlers: { POST: async ({ request }) => { ... } } }
  });
  ```

  Read raw body, extract signature header (Nango's docs: X-Nango-Signature —
  verify via Context7). Call `verifyNangoWebhook({ rawBody, signatureHeader })`
  from `packages/integrations`. Return 401 on invalid.
  For valid payloads:
  - `type === "sync"` events → look up `crm_connection.nango_connection_id`,
    enqueue `crm.sync` job for each model (Contact, Account/Company)
  - `type === "auth"` events → update `crm_connection.status` accordingly
    Return `{ received: true }` fast (queue does the work).

- `apps/web/src/lib/crm.functions.ts` — server fns:
  - `listCrmConnections()` — org-scoped
  - `createCrmConnectSession({ provider })` — admin gate via
    `isAdminOrOwner(ctx.orgContext)` (imported from `@quiksend/core`). Calls
    `nango.createConnectSession({ end_user: { id: user.id, email: user.email },
allowed_integrations: [provider] })` — verify current shape via Context7.
    Returns `{ sessionToken, connectUrl? }`.
  - `finalizeCrmConnection({ provider, nangoConnectionId })` — admin gate;
    insert `crm_connection` row with default `field_mapping` from
    `getProviderConfig(provider).defaultFieldMapping`. Enqueues initial `crm.sync`
    for Contact + Account/Company.
  - `updateFieldMapping({ connectionId, mapping })` — admin gate; validates mapping
    shape (Zod).
  - `disconnectCrm({ connectionId })` — admin gate; calls Nango to delete the
    connection then sets status='disconnected' locally.
  - `triggerCrmSync({ connectionId, model })` — enqueues `crm.sync`.

- `apps/web/src/routes/_protected/settings/crm/index.tsx` — page listing
  connections (status badge, last sync, actions: sync-now, edit mapping,
  disconnect). "Connect Salesforce" / "Connect HubSpot" buttons that call
  `createCrmConnectSession` → open Nango Connect UI via `@nangohq/frontend`
  → on success call `finalizeCrmConnection`.

- `apps/web/src/routes/_protected/settings/crm/$connectionId/mapping.tsx` —
  field mapping editor. Left column shows Quiksend fields
  (from provider config's `defaultFieldMapping` keys), right column is a
  free-text input with a "reset to default" button.

Show toasts on success/failure via `sonner`.

### T8 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase3_crm_connection
pnpm db:migrate
pnpm check     # MUST be green
pnpm worker:dev  # (in another terminal) boot the worker
```

Then manually verify:

- Load `/settings/crm` in the running web app — you should see empty state +
  the two connect buttons.
- The worker log should show `hello.ping` (from foundations) AND a new
  "job handler registered: crm.sync" line.
- `curl -X POST -H "X-Nango-Signature: xxx" -d '{...}' http://localhost:3000/api/nango/webhook`
  with an invalid sig → returns 401 (log the response).
- If you have Nango sandbox credentials, actually connect a HubSpot dev
  account, run a sync, confirm records upsert. If you don't (likely), note
  "no live smoke available; unit-tested upsert path only" in RESULT.notes.

## Constraints

- **Touch ONLY** files under "Track 3 owns" in WAVE_CONTEXT.md plus:
  - `packages/db/src/schema/index.ts` (one export line)
  - `packages/db/src/tenancy-guard.test.ts` (add table names)
  - `packages/db/src/testing.ts` (add table names)
  - `apps/worker/src/index.ts` (add registerHandler call)
  - `apps/web/src/routes/routeTree.gen.ts` (auto)
- **DO NOT** touch `packages/db/src/schema/{prospects,mail}.ts` — those are
  Tracks 2 & 4.
- **DO NOT** modify `packages/integrations/src/{nango.ts,webhook.ts,providers/**}`
  — foundations already shipped them. BUILD ON THEM.
- Nango Cloud was chosen; do not add a self-hosted Nango compose service.
- Context7 MCP for `@nangohq/node`, `@nangohq/frontend`, TanStack Start docs.
- Explicit `.ts`/`.tsx` extensions.

## Result

```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/crm.ts", "..."],
  "notes": "Phase 3 back-half complete. pnpm check green. Worker registers crm.sync handler at boot. Webhook route verified rejects invalid signatures. Nango live smoke deferred (no sandbox creds); upsert unit tests cover attach-by-email and local-edit-wins paths."
}
```
