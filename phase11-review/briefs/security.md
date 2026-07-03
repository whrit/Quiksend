# SECURITY REVIEW — Phase 11

## Task

Read-only review of the Phase 11 shipped code (v2.1.1..v2.2.1) through the security
lens. Write findings to `phase11-review/findings/security.md` following the format
in `phase11-review/CONTEXT.md`.

## Focus areas (in priority order)

### P1 — must verify

1. **Tenant isolation on new tables**
   - `seed_inbox`: verify every read path filters by `organization_id` (or explicitly allows NULL org_id for provider-managed pool reads AND that these are gated on the Pro entitlement check)
   - `canary_send`: verify every read/insert/update filters by `organization_id`
   - `deliverability_snapshot`: verify org filter on reads
   - `gateway_classification`: verify this is INTENTIONALLY shared (no org filter) — the design says so, but confirm no accidental leakage of prospect data via the cache
   - Consider extending `APP_SCOPED_TABLES` in `packages/db/src/tenancy-guard.test.ts` — do all new org-scoped tables appear there?

2. **IMAP credential handling**
   - `SYSTEM_SEED_ENCRYPTION_KEY` vs `MAILBOX_ENCRYPTION_KEY` — separate encryption domains as spec requires?
   - Verify user-provided seed inboxes use `MAILBOX_ENCRYPTION_KEY` (via existing `packages/mail/src/crypto.ts`)
   - Verify provider-managed seed inboxes use `SYSTEM_SEED_ENCRYPTION_KEY` (new key)
   - Verify decrypted IMAP credentials NEVER hit logs (grep worker code for logger.info with password-related payloads)
   - Verify no workspace admin API path exposes provider-managed seed IMAP details

3. **DNS-based classification: cache poisoning + injection**
   - `packages/mail/src/gateway-detect.ts`: is the input `email` validated for shape before `resolveMx(domain)`?
   - Any way an attacker could get us to run MX lookups against internal domains? (SSRF-like)
   - `gateway_classification.mx_records` stored as jsonb — verify no injection into UI rendering (should be display-only)
   - What if a user imports a prospect with a domain that resolves to a poisoned MX record? Do we validate MX hostnames against a shape (RFC 1123)?

4. **Canary poller auth model**
   - `apps/worker/src/handlers/canary-check.ts` — the worker connects to seed IMAP endpoints. Verify that seed_inbox credentials are only decrypted inside the poller and never surface in error paths / logs / DB writes
   - Does the poller correctly separate user-provided vs provider-managed IMAP connection auth?
   - Rate limiting on IMAP connections — could a hostile seed inbox config cause the worker to DoS a legitimate IMAP endpoint?

5. **Webhook event scope**
   - Phase 11 added 4 events to `SUPPORTED_WEBHOOK_EVENTS`. Verify each event's payload does NOT leak cross-tenant data
   - Specifically `gateway.detected` — payload includes prospect data? Verify only fires within owning org
   - `deliverability.canary.silent_drop` — payload should NOT include seed inbox credentials or system-owned IMAP config
   - Do these events actually fire from worker/handler code, or are they just listed in the UI but never emitted? (falls into completeness but flag if payload construction has security concerns)

### P2 — should verify

6. **Provider-managed seed access endpoints**
   - `isEntitledToProviderSeeds` — verify the entitlement check reads from `organization.metadata.entitlements` and can't be bypassed via URL manipulation
   - `getProviderManagedSeedGateways` — verify it only returns aggregate gateway counts, not seed identifiers or credentials

7. **Content sanitizer**
   - `packages/mail/src/content-sanitizer.ts`: verify it handles malformed MIME defensively (no crash on unusual inputs)
   - When it inlines images as base64, is there a size cap enforced BEFORE loading into memory?
   - Could a malicious user template exploit the sanitizer to strip/keep tracking against workspace intent?

8. **Routing policy tampering**
   - `setWorkspaceDeliverabilityPolicy` server-fn — verify admin role gate
   - Can a non-admin bypass to enable "off" and skirt the routing guard?

### P3 — informational

9. **Auto-downgrade**
   - `mailbox.enterprise_safe_auto_downgraded` — who can clear it? Verify admin-only.
   - Once auto-downgraded, is there an audit trail? Should this fire an alert?

## Do

- Grep for uses of `SYSTEM_SEED_ENCRYPTION_KEY` — verify it's only referenced where it should be
- Grep for `logger.` calls in `apps/worker/src/handlers/canary-check.ts` and `seed-inbox-verify.ts` — anything that could log a password?
- Check `apps/web/src/routes/api/v1/*` for any Phase 11 route additions — verify API key scope
- Check the Nango webhook handler for changes — does Phase 11 handle inbound signals correctly?
- Look at `APP_SCOPED_TABLES_TO_TRUNCATE` in `packages/db/src/testing.ts` — does it include the 3 new tables?

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`
- Wave 5 security review (baseline): `review/findings/security.md`
- CLAUDE.md — auth chokepoint expectations
