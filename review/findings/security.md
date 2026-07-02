# Security Review Findings

## Summary

- Files reviewed: ~45 (server fns, API v1 routes, auth, crypto, webhooks, worker sequence path, AI research/generation, env schema)
- Critical: 1, High: 2, Medium: 6, Low: 4
- Overall: **needs-fixes**

### P1 invariant checklist (verified in code)

| Invariant                                       | Status        | Notes                                                                                                               |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tenancy chokepoint (`orgFn` / `authMiddleware`) | **Mostly OK** | All `*.functions.ts` exports use `orgFn` except session read-only `getSession`                                      |
| Cross-org query filters (server fns + API)      | **OK**        | Spot-checked `findFirst`/`update`/`delete` paths; API returns **404** for other-org IDs                             |
| API key scoping                                 | **OK**        | `resolveApiKey` -> `{ apiKeyId, orgId, userId }`; handlers filter by `ctx.orgId`                                    |
| Nango inbound HMAC                              | **OK**        | `verifyNangoWebhook` + `env.NANGO_WEBHOOK_SECRET`; **no replay window** (see SEC-004)                               |
| Outbound webhook HMAC + replay window           | **Partial**   | HMAC + 300s skew verify; **no nonce** (see SEC-005)                                                                 |
| Unsubscribe token                               | **OK**        | HMAC-SHA256, `base64url`, `timingSafeEqual`, `UNSUBSCRIBE_TOKEN_SECRET`                                             |
| SMTP AES-256-GCM                                | **OK**        | Random 12-byte nonce, auth tag, 32-byte key validation                                                              |
| Better Auth session hardening                   | **OK**        | Default Better Auth cookies: `httpOnly`, `SameSite=Lax`, CSRF enabled (not disabled in `packages/auth/src/auth.ts`) |

---

## Findings

### [SEC-001] Outbound sends ignore `suppression` table (only prospect `status` checked in engine)

- Location: `apps/worker/src/sequence/guards.ts:7-9`, `apps/worker/src/sequence/execute-step.ts:27-38`, `apps/web/src/lib/inbox.functions.ts:445-478`, `apps/web/src/lib/compose.functions.ts:111-175`, `apps/worker/src/sequence/inbound-handler.ts:71-82`
- Severity: **critical**
- What: Sequence executor calls `isSuppressed(ctx)` which only checks prospect **status** (`unsubscribed`, `do_not_contact`), not the `suppression` table. Manual suppress (`suppressEmail`) inserts into `suppression` but **does not** update `prospect.status`. Hard bounces insert `suppression` rows but likewise do not set prospect status in the worker path. `sendComposedMessage` sends without any suppression or status gate. Enrollment APIs do not filter suppressed emails before creating enrollments.
- Impact: Emails can be sent to addresses explicitly on the suppression list (manual block, hard bounce, complaint) if prospect status remains `active`/`new`. Re-enrollment into a new sequence can resume mail to bounced/unsubscribed addresses. CAN-SPAM / deliverability / legal exposure.
- Fix: Before every outbound send (worker `execute-step`, compose, inbox reply), query `suppression` for `(organizationId, email)`. Align `suppressEmail`, bounce handler, and unsubscribe to update `prospect.status`. Skip or reject enrollment when suppressed.
- Confidence: **high**

### [SEC-002] `/api/auth/*` IP rate limit implemented but never wired

- Location: `apps/web/src/lib/api/v1/middleware.ts:175-188`, `apps/web/src/routes/api/auth/$.ts:4-9`
- Severity: **high**
- What: `checkAuthIpRateLimit` exists with per-IP token bucket, but the auth route delegates directly to `auth.handler(request)` with no rate-limit call.
- Impact: Credential stuffing, password-guessing, and OAuth callback abuse on auth endpoints are unlimited per IP (modulo whatever Better Auth provides internally).
- Fix: Wrap `GET`/`POST` handlers: if `!checkAuthIpRateLimit(request)` return 429 before `auth.handler`. Consider Redis/DB-backed limits for multi-instance deploys.
- Confidence: **high**

### [SEC-003] Production-critical secrets optional at startup

- Location: `packages/config/src/env.schema.ts:18-19`, `packages/config/src/env.schema.ts:29-30`, `packages/config/src/env.schema.ts:43-48`, `packages/config/src/env.ts:11-21`
- Severity: **high**
- What: `BETTER_AUTH_SECRET`, `NANGO_WEBHOOK_SECRET`, `MAILBOX_ENCRYPTION_KEY`, and `UNSUBSCRIBE_TOKEN_SECRET` are `.optional()` in `EnvSchema`. Loader only validates shape, not production conditionals.
- Impact: Production can boot with weak/missing auth secret; Nango webhooks rejected when secret missing (`packages/integrations/src/webhook.ts:20-21`); unsubscribe/mailbox features fail at runtime instead of fail-fast deploy.
- Fix: Use `z.refine` or a production-only schema branch to require these when `NODE_ENV=production`. Document minimum secret length for `BETTER_AUTH_SECRET`.
- Confidence: **high**

### [SEC-004] Nango inbound webhooks: no replay / idempotency after signature verify

- Location: `apps/web/src/routes/api/nango/webhook.ts:28-76`, `packages/integrations/src/webhook.ts:19-28`
- Severity: **medium**
- What: Valid HMAC allows unlimited replays of the same body. Each replay re-enqueues `crm.sync` for the connection. No timestamp window, event ID dedup, or idempotency store.
- Impact: Replay attacks (or Nango retries) can amplify CRM sync load, cause duplicate inbound upserts, and obscure audit trails. Distinct from CRM **writeback** idempotency (`crm_writeback_log.idempotency_key`).
- Fix: Store processed webhook IDs or `(connectionId, model, syncCursor)` with TTL; reject duplicates.
- Confidence: **high**

### [SEC-005] Outbound webhook signing uses timestamp only (no nonce)

- Location: `apps/worker/src/handlers/webhook-deliver.ts:17-37`, `apps/worker/src/handlers/webhook-deliver.ts:77-94`
- Severity: **medium**
- What: Signature is HMAC over `timestamp + JSON payload`. Receivers can enforce 300s skew via `verifyWebhookSignature`, but no nonce; `X-Quiksend-Delivery-Id` is not in the MAC input.
- Impact: Captured valid delivery can be replayed to the customer endpoint within the 300s skew window.
- Fix: Include `deliveryId` or random nonce in signed payload; document receiver verification.
- Confidence: **high**

### [SEC-006] API and auth rate limits are in-process only

- Location: `apps/web/src/lib/api/v1/middleware.ts:107-121`, `apps/web/src/lib/api/v1/middleware.ts:176-188`, `apps/web/src/lib/api/v1/helpers.ts:94-106`
- Severity: **medium**
- What: API limits use DB count on `api_key_usage`; auth limit uses in-memory `Map`.
- Impact: Limits reset on process restart; horizontal scaling gives per-instance auth buckets (effective Nx limit).
- Fix: Centralize auth rate limiting (Redis/Postgres). Consider global IP cap in addition to per-key.
- Confidence: **medium**

### [SEC-007] `captureManualAnchorForEnrollment` loads sequence without org filter

- Location: `apps/web/src/lib/compose.functions.ts:313-315`
- Severity: **medium**
- What: Sequence fetched by ID only after org-scoped enrollment lookup.
- Impact: Defense-in-depth gap if FK integrity breaks.
- Fix: Add `eq(tables.sequence.organizationId, input.organizationId)` to the `where` clause.
- Confidence: **medium**

### [SEC-008] Prompt injection: scraped content inlined without structural escaping

- Location: `packages/ai/src/research/fetch-and-summarize.ts:18-52`, `packages/ai/src/generation/prompt-builder.ts:109-112`
- Severity: **medium**
- What: Web text concatenated into prompts; system guards and Zod schema partially mitigate.
- Impact: Adversarial pages could steer research or copy generation.
- Fix: Delimiter wrapping, HTML strip, two-pass citation extraction.
- Confidence: **medium**

### [SEC-009] `getSession` bypasses `authMiddleware` (by design)

- Location: `apps/web/src/lib/auth.functions.ts:5-8`
- Severity: **low**
- What: Read-only session via Better Auth; no DB tenancy path.
- Impact: Expected for UI; no cross-tenant data leak.
- Fix: Document intentional exception.
- Confidence: **high**

### [SEC-010] `disconnectCrm` update WHERE omits `organizationId`

- Location: `apps/web/src/lib/crm.functions.ts:166-170`
- Severity: **low**
- What: Update uses connection id only after org-scoped fetch.
- Fix: Include `organizationId` in update `where`.
- Confidence: **high**

### [SEC-011] `/api/v1/*` CSRF — bearer token

- Location: `apps/web/src/lib/api/v1/middleware.ts:28-31`
- Severity: **low** (informational)
- What: Bearer API key auth; CSRF moot for standard clients.
- Confidence: **high**

### [SEC-012] `WEBHOOK_SIGNING_SECRET` env var unused

- Location: `packages/config/src/env.schema.ts:46`
- Severity: **low**
- What: Per-endpoint secrets used; global var never read.
- Confidence: **high**

---

## SQL injection / path traversal (P2 sweep)

- **SQL**: Parameterized Drizzle `sql` templates; no `sql.raw` with user input found. No issues identified (confidence: medium).
- **Path traversal**: CSV import uses in-request rows, not filesystem paths. No issues (confidence: high).

---

## Positive observations

- API wrong-org UUIDs return **404** (`apps/web/src/routes/api/v1/prospects.$id.ts:36-43`).
- API key metadata org binding on create/revoke (`apps/web/src/lib/api-keys.functions.ts`).
- Unsubscribe: token verify, org-scoped prospect, suppression + status update (`apps/web/src/routes/api/v1/unsubscribe.ts`).
- CRM writeback idempotency via `idempotency_key` (`apps/worker/src/handlers/crm-writeback.ts:224-230`).
- SMTP AES-256-GCM (`packages/mail/src/crypto.ts`); Nango `timingSafeEqual` (`packages/integrations/src/webhook.ts:27-28`).
- Better Auth CSRF not disabled; Context7 docs confirm default `httpOnly` / `SameSite=Lax` cookies.
