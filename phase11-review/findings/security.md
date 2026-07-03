# Security Review Findings

## Summary

- Files reviewed: ~38 (Phase 11 schema, seed/canary handlers, gateway-detect, content-sanitizer, deliverability/seed server fns, org-fn chokepoint, webhook registry, Nango webhook, tenancy guard, seed-crypto, seed-imap, deliverability UI)
- Critical: 0, High: 0, Medium: 3, Low: 4
- Overall: **needs-fixes**

### P1 invariant checklist (Phase 11 focus)

| Invariant                                           | Status              | Notes                                                                                                                                                    |
| --------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation — `seed_inbox` user paths          | **OK**              | Web mutations filter `organizationId`; provider pool reads gated on `isDeliverabilityProEntitled`                                                        |
| Tenant isolation — `seed_inbox` worker paths        | **OK**              | Worker jobs are global cron/queue consumers by design; lookups keyed by UUID from prior scoped inserts                                                   |
| Tenant isolation — `canary_send`                    | **OK**              | Web reads/writes filter `organizationId`; worker updates keyed by row `id` from prior query                                                              |
| Tenant isolation — `deliverability_snapshot`        | **OK**              | Grid read filters `organizationId`; rollup SQL groups by `cs.organization_id`                                                                            |
| `gateway_classification` intentionally shared       | **OK**              | No `organization_id` column; stores domain-level gateway/MX/evidence only — no prospect PII                                                              |
| `APP_SCOPED_TABLES` includes Phase 11C tables       | **OK**              | `seedInbox`, `canarySend`, `deliverabilitySnapshot` present; CI guard passes                                                                             |
| Encryption domain split (user vs provider seeds)    | **OK**              | `resolveSeedEncryptionKey` uses `MAILBOX_ENCRYPTION_KEY` vs `SYSTEM_SEED_ENCRYPTION_KEY`                                                                 |
| Provider IMAP credentials hidden from workspace API | **OK**              | `PublicSeedInbox` omits `imapConfig`; only aggregate counts in `getProviderManagedSeedGateways`                                                          |
| Decrypted IMAP creds not logged                     | **OK**              | `canary-check.ts` / `seed-inbox-verify.ts` log `{ err, seedInboxId }` only — no config/pass fields                                                       |
| Phase 11 webhook payload cross-tenant leakage       | **N/A (not wired)** | Three of four Phase 11 webhook types are never emitted; `enrollment.no_safe_mailbox_for_gateway` writes org-scoped `event` rows only (no webhook fanout) |
| Admin gate on routing policy                        | **OK**              | `setWorkspaceDeliverabilityPolicy` calls `requireAdmin`                                                                                                  |
| Auto-downgrade clear is admin-only                  | **OK**              | `setMailboxEnterpriseSafe` requires admin; sets `enterpriseSafeAutoDowngraded: false` when re-declaring safe                                             |

---

## Findings

### [SEC-P11-001] User seed IMAP config allows arbitrary host — worker makes outbound connections

- **Location**: `apps/web/src/lib/seed-inbox.functions.ts:51-56`, `apps/web/src/lib/seed-inbox.functions.ts:95-100`, `apps/worker/src/deliverability/seed-imap.ts:103-110`, `apps/worker/src/handlers/canary-check.ts:87-96`
- **Severity**: medium
- **Confidence**: high
- **What**: `createUserSeedInbox` accepts any `imapHost` / `imapPort` from a workspace admin with only `z.string().min(1)` validation. The worker decrypts the config and opens real IMAP connections in `seed-inbox-verify` and every 5 minutes in `canary-check` (`searchCanaryMessages` → `ImapFlow.connect`).
- **Impact**: A compromised or malicious workspace admin can point seed inboxes at internal IPs/hostnames (metadata endpoints, internal mail gateways, other tenants' IMAP). The worker process becomes an SSRF/port-probe relay on a recurring schedule. This is distinct from DNS-based gateway detection — it is a TCP connection initiated by the worker.
- **Fix**: Validate `imapHost` against an allowlist or blocklist (reject RFC1918, link-local, `localhost`, cloud metadata hosts, bare IPs unless explicitly allowed). Consider requiring provider enum to constrain known host patterns (e.g. `outlook.office365.com`, `imap.gmail.com`). Add connection timeout and per-org rate limits on verify/poll jobs.

### [SEC-P11-002] DNS gateway classification has no guard on lookup target domains

- **Location**: `packages/mail/src/gateway-detect.ts:133-138`, `packages/mail/src/gateway-detect.ts:225-231`, `packages/mail/src/dns.ts:18-44`, `apps/web/src/lib/prospects.functions.ts:1124-1136`
- **Severity**: medium
- **Confidence**: medium
- **What**: `detectEmailGateway` extracts the domain from an email and calls `resolveMxRecords` / `resolveTxtRecords` with no shape validation beyond trimming. `reclassifyDomain` (admin-only) accepts any `emailDomain` string up to 255 chars and enqueues `probe@${domain}` for MX/TXT/DMARC/SPF resolution. There is no blocklist for `.local`, `.internal`, `localhost`, or metadata-style hostnames.
- **Impact**: Authenticated users (prospect import, `classifyEmail`) or admins (`reclassifyDomain`) can cause the worker to perform DNS lookups against attacker-chosen domains. A workspace admin can also delete and force re-probe cached domains. Combined with the globally shared `gateway_classification` table, an attacker who controls DNS for a domain can poison the cached gateway for that domain, affecting **all workspaces** whose prospects share the same email domain (by design, but exploitable).
- **Fix**: Add domain validation before DNS (reject invalid labels, single-label hosts except allowlist, reserved/special-use names). Rate-limit per-org classification enqueue. Optionally require admin for manual reclassify and log audit events (already partially present for policy changes).

### [SEC-P11-003] `classifyEmail` lets any workspace member enqueue DNS classification jobs

- **Location**: `apps/web/src/lib/prospects.functions.ts:1100-1121`
- **Severity**: medium
- **Confidence**: high
- **What**: `classifyEmail` is exposed via `orgFn` without `requireAdmin` or role check. Any member can POST a valid email and, on cache miss, enqueue `gateway.detect_single`, triggering MX/TXT/DMARC/SPF lookups in the worker.
- **Impact**: Low-privilege members can abuse classification as a DNS oracle or contribute to resolver load. In multi-tenant deployments this expands the attack surface beyond admins and import flows.
- **Fix**: Gate on `isAdminOrOwner`, or add per-org rate limiting / daily quota on classification enqueues.

### [SEC-P11-004] Phase 11 webhook event types registered but not emitted through fanout

- **Location**: `packages/db/src/schema/api.ts:26-29`, `apps/worker/src/sequence/execute-effects.ts:19-26`, `apps/worker/src/handlers/canary-check.ts:230-236`
- **Severity**: low
- **Confidence**: high
- **What**: `gateway.detected`, `deliverability.canary.arrived`, and `deliverability.canary.silent_drop` appear in `SUPPORTED_WEBHOOK_EVENTS` and the webhooks settings UI, but no production code calls `insertDomainEventAndFanout` or `fanoutWebhookEvent` for these types. `enrollment.no_safe_mailbox_for_gateway` is persisted to `event` via `handleEmitEvent` but is also not webhook-fanned-out (same pattern as pre-Phase-11 engine events).
- **Impact**: No active cross-tenant payload leakage today because deliveries are never constructed. Risk is latent: a future fanout wiring could ship without a payload review. Auto-pause writes `canary.silent_drop_detected` to `event` with gateway/mailbox stats — not the same as the registered `deliverability.canary.silent_drop` webhook name.
- **Fix**: When wiring fanout, construct payloads from org-scoped IDs only (no seed IMAP config, no provider pool identifiers). Align internal `event.type` strings with `SUPPORTED_WEBHOOK_EVENTS` names. Until wired, remove from UI enum or mark "coming soon" to avoid integrator confusion.

### [SEC-P11-005] `APP_SCOPED_TABLES_TO_TRUNCATE` omits Phase 11 tables

- **Location**: `packages/db/src/testing.ts:25-52`
- **Severity**: low
- **Confidence**: high
- **What**: Test harness truncation list includes Phase 10 tables but not `seed_inbox`, `canary_send`, or `deliverability_snapshot`. `gateway_classification` is correctly global and should stay excluded.
- **Impact**: Integration tests using `withTestOrgs()` may leak seed/canary rows across tests, causing flaky cross-test visibility. Not a production tenant-isolation defect, but can mask tenancy bugs in CI.
- **Fix**: Add `canary_send`, `seed_inbox`, `deliverability_snapshot` to `APP_SCOPED_TABLES_TO_TRUNCATE` (respect FK order: canary before seed).

### [SEC-P11-006] `listSeedInboxes` exposes provider-managed seed email addresses to entitled workspaces

- **Location**: `apps/web/src/lib/seed-inbox.functions.ts:76-83`, `apps/web/src/lib/seed-inbox.functions.ts:38-48`
- **Severity**: low
- **Confidence**: high
- **What**: Deliverability Pro entitlement merges provider pool rows into the same list returned to the UI, including `email`, `gateway`, and `providerManaged: true`. `getProviderManagedSeedGateways` correctly returns aggregate counts only, but `listSeedInboxes` goes further.
- **Impact**: Spec requires hiding provider IMAP credentials ( satisfied ) but Quiksend Systems seed **addresses** become visible to every Pro workspace admin. Minor ops intelligence leak if seed addresses are considered confidential infrastructure.
- **Fix**: If spec intent is full opacity, show provider rows as "Proofpoint pool (3 seeds)" without email addresses; keep addresses server-side only.

### [SEC-P11-007] Canary poller opens unbounded parallel IMAP connections per cron tick

- **Location**: `apps/worker/src/handlers/canary-check.ts:43-48`, `apps/worker/src/deliverability/seed-imap.ts:59-98`
- **Severity**: low
- **Confidence**: medium
- **What**: `runCanaryCheck` groups pending canaries by seed and runs `Promise.all` over every distinct seed inbox in the due set with no concurrency cap (contrast: gateway detect uses `DNS_CONCURRENCY = 50`). Each poll opens a full IMAP session, iterates up to 9 folder candidates, and fetches message sources.
- **Impact**: Many active seeds (user + provider) can spike worker connections and memory. A workspace adding many user seeds could increase worker load; combined with SEC-P11-001, also amplifies outbound connection volume to attacker-chosen hosts.
- **Fix**: Add a semaphore (e.g. max 10 concurrent IMAP polls), per-seed cooldown, and explicit connection/login timeout on `ImapFlow`.

---

## Positive observations

- **Encryption domain split is correctly implemented.** `packages/mail/src/seed-crypto.ts:27-39` routes `organizationId === null` to `SYSTEM_SEED_ENCRYPTION_KEY` and user seeds to `MAILBOX_ENCRYPTION_KEY`; bootstrap script passes `null` org id (`scripts/seed-pool-bootstrap.ts:63-70`).
- **Provider IMAP secrets never reach the workspace API surface.** `toPublic()` strips `imapConfig`; mutations on provider rows are impossible because all write paths require `eq(tables.seedInbox.organizationId, organizationId)` (`apps/web/src/lib/seed-inbox.functions.ts:140-147`).
- **Pro entitlement is read from server-side org metadata only.** `isDeliverabilityProEntitled` parses `organization.metadata.entitlements.deliverability_pro.activeUntil` — no client-supplied bypass path (`apps/web/src/lib/canary-injection.ts:146-157`).
- **Tenancy CI guard covers Phase 11C tables and passes.** `packages/db/src/tenancy-guard.test.ts:52-55` includes all three new org-scoped tables.
- **Gateway cache is appropriately global and PII-free.** `gateway_classification` stores domain, gateway enum, MX hostnames, and evidence strings — not tied to a workspace; prospect rows copy classification into org-scoped `gateway_evidence` (`apps/worker/src/handlers/gateway-detect.ts:56-80`).
- **MX/evidence rendering is XSS-safe.** UI uses React text/`title` attributes and `JSON.stringify` inside `<pre>` (`apps/web/src/components/gateway-badge.tsx:38-60`, `apps/web/src/routes/_protected/deliverability/index.tsx:144-147`) — no `dangerouslySetInnerHTML`.
- **Content sanitizer enforces size/time bounds on async inlining.** `MAX_INLINE_IMAGE_BYTES = 100 * 1024` and `AbortSignal.timeout(5000)` before buffering (`packages/mail/src/content-sanitizer.ts:17-55`).
- **Auto-pause audit trail exists.** `pauseSequenceCampaign` inserts org-scoped `canary.silent_drop_detected` events and emails admins (`apps/worker/src/handlers/canary-check.ts:230-239`); clearing auto-downgrade requires admin via `setMailboxEnterpriseSafe` (`apps/web/src/lib/mailboxes.functions.ts:512-530`).
- **Nango webhook replay protection improved since Wave 5.** `claimNangoWebhook` deduplicates via `nango_webhook_processed` (`apps/web/src/routes/api/nango/webhook.ts:38-44`, `apps/web/src/routes/api/nango/webhook.ts:77-84`).
- **No new unauthenticated Phase 11 API v1 routes.** Deliverability/seed features are session + `orgFn` only; existing API v1 surface unchanged.
- **Routing policy tamper resistance.** Non-admins cannot call `setWorkspaceDeliverabilityPolicy` (`apps/web/src/lib/organization.functions.ts:54-55`); routing enforce/warn/off requires admin POST.
