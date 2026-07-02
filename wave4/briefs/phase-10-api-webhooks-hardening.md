# PHASE-10: Public REST API + outbound webhooks + hardening + V0 DoD — Track M

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/phase-10-api-webhooks` from `main` (worktree isolated).

## Context
Read at repo root first:
1. `CLAUDE.md`
2. All `WAVE_CONTEXT.md` files
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` section "Phase 10"
4. `packages/auth/src/auth.ts` — apiKey plugin already wired
5. `packages/mail/src/compliance.ts` — unsubscribe URL placeholder from Phase 4;
   you wire the real signed token here

Final phase. When this merges, V0 DoD is complete → v2.0.0 release.

## Documentation lookup (mandatory)
Context7 MCP for:
- **Better Auth** `apiKey` plugin — `authClient.apiKey.create()` +
  server-side `verify` API to resolve `{ org, member }` from an incoming key
- **TanStack Start** — `createFileRoute("/api/v1/prospects")` with `server.handlers`
- **Node `crypto`** — `randomBytes`, `createHmac`, `timingSafeEqual`
- **@openapitools** or manual OpenAPI 3.1 — spec generation for public docs

## Tasks

### T1 — Schema (`packages/db/src/schema/api.ts`)
- **`api_key_usage`** — id (bigserial), organization_id, api_key_id, 
  endpoint text, method text, status_code int, ip_address text,
  timestamp timestamptz default now notNull.
  Retention: partition by day (or a periodic purge job); for V0, a plain table
  with index `(api_key_id, timestamp DESC)` is fine.
- **`webhook_endpoint`** — id (uuid pk), organization_id, url text notNull,
  secret text notNull (auto-generated 32-byte hex), events text[] notNull
  (subset of `SUPPORTED_WEBHOOK_EVENTS`),
  status text default 'active' ('active' | 'paused' | 'error'),
  created_by_user_id text FK, timestamps.
- **`webhook_delivery`** — id (uuid pk), organization_id, endpoint_id (uuid FK cascade),
  event_type text, payload jsonb, status pg enum ('pending', 'succeeded', 'failed', 'dead'),
  attempts int default 0, response_status int nullable, response_body text nullable,
  next_attempt_at timestamptz nullable, timestamps.
  Index `(status, next_attempt_at)` for retry sweep.
- **`unsubscribe_token`** — NOT actually stored; the token is stateless
  (HMAC-signed `{prospectId, orgId, iat}`). Just define the constants/exp policy
  in `packages/mail/src/unsubscribe.ts`.

### T2 — Public REST API (`apps/web/src/routes/api/v1/`)

Each endpoint is a `createFileRoute` server route with GET/POST/PATCH/DELETE
handlers. Auth via a middleware helper:
```ts
async function resolveApiKey(request: Request): Promise<{ orgId: string; member: {...} } | null>
```
that calls Better Auth's apiKey verify. On invalid → 401.

Rate limiting: token bucket per api_key_id, 100 req/min default (configurable
per key later). Track in `api_key_usage`. Over-limit → 429 + `Retry-After` header.

Endpoints (list is illustrative; verify Phase 10 plan):
- `GET /api/v1/prospects` — list (query: status, list_id, cursor, limit)
- `POST /api/v1/prospects` — create/upsert single
- `GET /api/v1/prospects/{id}` — 404 outside org
- `PATCH /api/v1/prospects/{id}`
- `DELETE /api/v1/prospects/{id}` — soft delete
- `POST /api/v1/enrollments` — enroll `{ sequenceId, prospectIds[] }`
- `GET /api/v1/sequences/{id}/analytics` — funnel + step rates
- `GET /api/v1/messages` — list (query: mailbox_id, direction, cursor)
- `POST /api/v1/webhooks` — CRUD for webhook_endpoint
- `GET /api/v1/webhooks/{id}/deliveries` — recent deliveries

Every handler returns JSON envelopes: `{ data: ... }` or `{ error: { code, message } }`.

OpenAPI 3.1 spec at `apps/web/src/routes/api/v1/openapi.json.ts` (server route)
generated from Zod schemas (share the schemas with server fns where possible).

### T3 — Outbound webhooks (`apps/worker/src/handlers/webhook-deliver.ts`)

Register `webhook.deliver`:
```ts
registerHandler("webhook.deliver", async ({ deliveryId }) => {
  const delivery = await loadDelivery(deliveryId);
  const signature = signWebhook(delivery.payload, endpoint.secret);
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Quiksend-Signature': signature,
      'X-Quiksend-Delivery-Id': deliveryId,
      'X-Quiksend-Timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(delivery.payload),
  });
  // ... handle response, retry logic, mark 'dead' after N attempts
});
```

Signing:
```ts
signWebhook(payload, secret) = HMAC-SHA256(secret, timestamp + '.' + JSON.stringify(payload))
```
Include timestamp to prevent replay; receivers verify `abs(now - ts) < 300s`.

Retry: exponential backoff (1m, 5m, 30m, 3h, 12h) — 5 attempts total.

Enqueue point: Track L's `event` insert (Phase 9) — add a trigger or a small
`webhook-fanout` handler that runs when an `event` row is inserted, checks
which endpoints subscribed to that event type, enqueues one `webhook.deliver`
per subscribed endpoint.

### T4 — Unsubscribe (`packages/mail/src/unsubscribe.ts`)
Stateless signed token:
```ts
export function mintUnsubscribeToken({ prospectId, orgId }): string
export function verifyUnsubscribeToken(token: string): { prospectId, orgId } | null
```

`UNSUBSCRIBE_TOKEN_SECRET` env var (already declared) signs a
`{ prospectId, orgId, iat }` JSON payload with HMAC-SHA256, base64url-encoded.

Handler: `apps/web/src/routes/api/v1/unsubscribe.ts` — verifies token, inserts
`suppression` row (reason='unsubscribe'), enqueues `crm.writeback` for the CRM
status update (Phase 9). Renders a minimal HTML confirmation.

Update `compose.functions.ts` (Phase 4-back) — replace the placeholder
`https://app.example.com/u/pending` with `mintUnsubscribeToken(...)`.

### T5 — Hardening

- **Tenancy CI guard** — flip ON every remaining table in `APP_SCOPED_TABLES`.
  If any test fails → fix the offending file (add missing `organizationId`
  filter). This is the "no leaked rows" invariant.
- **Rate limits** — global per-IP for `/api/auth/*` (100/min), per-api-key for
  `/api/v1/*` (configurable).
- **Secrets review** — grep for any hardcoded secrets, ensure all pull from env.
- **Load test** (`scripts/load-test-scheduler.ts`) — script that seeds N
  workspaces × M enrollments × K steps, runs 2 workers concurrently for 5 min,
  asserts no double-send + no cap overshoot + no crashes. This is proving the
  Phase 6 engine holds under real load.
- **Self-host docker-compose** — verify `docker-compose.yml` still works
  end-to-end (Postgres + Mailpit + optional Nango). Add a `docker-compose.prod.yml`
  overlay that builds the web + worker images and wires them.
- **Seed script** — `pnpm db:seed` creates a demo org + user + connected
  Mailpit mailbox + 20 sample prospects + 1 sequence. For new self-hosters.
- **Docs** — update `README.md` with self-host quickstart; add `docs/api.md`
  linking to OpenAPI spec; add `docs/webhooks.md` with signing verification
  example.

### T6 — Verification (STRICT)
```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase10_api_webhooks
pnpm db:migrate
pnpm check   # green
pnpm ts-node scripts/load-test-scheduler.ts --workspaces=3 --enrollments=100 --workers=2 --duration=60
```

Manual smoke:
- Create an API key via UI.
- `curl -H "Authorization: Bearer <key>" localhost:3000/api/v1/prospects` — returns list.
- Try key from org A on org B's prospect id — 404.
- Register a webhook_endpoint via API; trigger a `message.sent` event; verify
  webhook fires with valid signature.
- Test unsubscribe link: from a real sent email, click unsubscribe → suppression
  row created + CRM writeback enqueued.
- Complete self-host quickstart from README on a clean machine.

## Constraints
- **Touch ONLY**:
  - `packages/db/src/schema/api.ts` (new)
  - `packages/db/src/schema/index.ts` (add exports)
  - `packages/db/src/tenancy-guard.test.ts` — flip ALL app tables on
  - `packages/db/src/testing.ts`
  - `packages/mail/src/unsubscribe.ts` (new)
  - `packages/mail/src/compliance.ts` (extend — accept a real minter function)
  - `apps/worker/src/handlers/webhook-deliver.ts` (new)
  - `apps/worker/src/handlers/webhook-fanout.ts` (new)
  - `apps/web/src/routes/api/v1/**` (new dir)
  - `apps/web/src/lib/webhooks.functions.ts` (new)
  - `apps/web/src/lib/api-keys.functions.ts` (new)
  - `apps/web/src/routes/_protected/settings/{api-keys,webhooks}/**` (new)
  - `apps/web/src/lib/compose.functions.ts` (extend — wire real unsubscribe minter)
  - `scripts/load-test-scheduler.ts` (new)
  - `pnpm db:seed` script: `packages/db/src/seed.ts` (new)
  - `README.md`, `docs/api.md`, `docs/webhooks.md`
  - `docker-compose.prod.yml` (new)
- Context7 MCP for Better Auth apiKey verify API, OpenAPI 3.1 conventions

## Result
```json
{
  "status": "ok",
  "files": ["apps/web/src/routes/api/v1/prospects.ts", "..."],
  "notes": "Phase 10 complete. V0 DoD achieved. pnpm check green. API tenancy verified (org A key gets 404 on org B's ids). Webhook signature roundtrip validated. Unsubscribe end-to-end works. Load test: 3 workspaces × 100 enrollments × 2 workers × 60s, zero double-sends, zero cap breaches, zero crashes. Self-host quickstart verified on clean docker-compose."
}
```
