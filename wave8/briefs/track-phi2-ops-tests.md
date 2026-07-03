# TRACK PHI2 — Provider Ops Crons + Testing Gaps + Architecture Cleanup

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave8-phi2-ops-tests` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave8/WAVE_CONTEXT.md`
3. `phase11-review/CONSOLIDATED.md`
4. `phase11-review/findings/completeness.md` § COMP-P11-002, 003, 007, 008, 009
5. `phase11-review/findings/testing.md` § TEST-005, 006, 007, 008, 010, 011, 012, 013, 014
6. `phase11-review/findings/security.md` § SEC-P11-001, SEC-P11-005
7. `phase11-review/findings/architecture.md` § ARCH-001, 002, 003, 005, 006
8. `phase11-review/findings/correctness.md` § CORR-007
9. `phase11-review/findings/performance.md` § PERF-015, PERF-016
10. `internal-runbooks/seed-pool-setup.md`, `internal-runbooks/seed-pool-legit-usage-patterns.md`
11. `packages/core/src/state-machine/types.ts`, `transition.ts`
12. `scripts/load-test-engine.ts`

## Findings assigned (13 CRs — mixed severity)

### High (2)
- **CR-09** — Implement 11C.18 `seed_pool.health_check` + 11C.19 `seed_pool.generate_legit_mail` crons
- **CR-11** — Wire canary load-test modes (canary-happy-path + canary-auto-pause) with fixture + assertions

### Medium (5)
- **CR-19** — IMAP host allowlist for user seed (SSRF protection)
- **CR-21** — 6 spec-mandated missing tests: content sanitizer edge cases, gateway single/sweep, per-group auto-pause, snapshot rollup, seed crypto round-trip, gateway-detection load-test
- **CR-22** — Phase 11 tables missing from `APP_SCOPED_TABLES_TO_TRUNCATE`
- **CR-27** — Canary effect kinds `send_canary` + `emit_canary_bundle` orphaned in state machine (Option A: remove)
- **CR-37** — `gateway-detection` load-test mode from spec not implemented

### Low (6)
- **CR-28** — SEG gateway allowlist duplicated across 4 locations (CODE dedup — SIGMA does docs)
- **CR-29** — Content sanitizer `preferPlainText` completeness heuristic
- **CR-32** — Dead exports: `newCanaryToken`, `sanitizeForSegAsync`, duplicated `extractDomain`
- **CR-33** — `gatewayClassification` lacks Drizzle `relations()` (add empty block for consistency)
- **CR-36** — Test suite wall-clock ~56s (informational; note in Wave 9 backlog)
- **CR-38** — Entry conditions lack combined `if_no_reply` + gateway predicate test

## Documentation lookup (mandatory)
Context7 MCP for:
- **`imapflow` v1.4.3** — LOGIN + LIST for health check, connection semantics
- **pg-boss v12** — cron schedule syntax (`0 * * * *` for hourly, `0 0 * * 0` for weekly Sunday, etc.)
- **Vitest** — mocking IMAP for handler tests, snapshot table fixtures

## Tasks

### T1 — Fix CR-09 (implement seed pool crons)

**NEW `apps/worker/src/handlers/seed-pool-health.ts`**:
- Cron: daily (24h) — `0 0 * * *`
- Handler: for each active `seed_inbox WHERE organization_id IS NULL`:
  - Attempt IMAP LOGIN (respect connection timeouts)
  - LIST INBOX
  - Check message count in last 30 days for dormancy (low = warning)
  - On failure: insert `event` row `type='seed_pool.health_check_failed'`, log warn, optionally email `SYSTEM_ADMIN_EMAIL` (env var, optional)
- Register handler in `apps/worker/src/index.ts` after existing seed_inbox_verify
- Register in `packages/queue/src/jobs.ts` as new job type `seed_pool.health_check`
- Schedule via pg-boss cron in worker boot

**NEW `apps/worker/src/handlers/seed-pool-legit-mail.ts`**:
- Cron: weekly (Sunday 00:00) — `0 0 * * 0`
- Handler:
  - Load `internal-runbooks/seed-pool-legit-usage-patterns.md` as reference (or hardcode templates in the handler since runbooks are internal-only)
  - For each active provider-managed seed, pick a random template, cap at 5 messages/seed/week
  - Send via one seed to another (cross-send pattern) using the same adapter as canary sends
  - Log each send with `event` row `type='seed_pool.legit_mail_sent'`
- Register in worker boot + jobs.ts

Both handlers use `SYSTEM_SEED_ENCRYPTION_KEY` for provider seed IMAP credentials.

**Tests**: `apps/worker/src/handlers/seed-pool-health.test.ts` + `seed-pool-legit-mail.test.ts` — mock IMAP + adapter, seed provider seeds via `withTestOrgs` (org=NULL), assert cron runs.

### T2 — Fix CR-11 (canary load-test modes)

`scripts/load-test-engine.ts`:
- Add `seedCanaryFixture` function that provisions: 2 orgs, 2 SEG-tagged prospects/org, 3 seed inboxes/org, injects canaries via `injectCanariesForEnrollment`
- Add case for `canary-happy-path`:
  - Seed happy path: 100 canaries across 5 seeds
  - Assert all reach terminal arrival status within duration
  - Assert deliverability_snapshot rows populated
  - Assert no double-sends
- Add case for `canary-auto-pause`:
  - Seed with an IMAP mock returning `not_found` for 3+ canaries
  - Assert `maybePauseCampaigns` marks sequence paused
  - Assert email + event fired

Add `gateway-detection` mode (CR-37):
- 500 prospects across 50 domains (mocked resolver)
- Assert all classifications complete within 30s
- Assert cache populated

### T3 — Fix CR-19 (IMAP host allowlist)

`apps/web/src/lib/seed-inbox.functions.ts` `createUserSeedInbox`:
- Add `imapHost` validation: reject RFC1918 ranges (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x), localhost, `.local`, `.internal`, `.test`, bare IPs unless allowlisted, cloud metadata endpoints (169.254.169.254)
- Preferred: define a `SAFE_IMAP_HOSTS` allowlist (imap.gmail.com, outlook.office365.com, imap.mail.me.com, imap.mail.yahoo.com, custom.smtp.something) — or accept any valid public FQDN not in a blocklist
- On rejection, return validation error to user; log security-warn

`apps/worker/src/handlers/seed-inbox-verify.ts`: same validation before opening IMAP connection (defense in depth).

Test: `seed-inbox.functions.test.ts` — attempt to create seed inbox with `imapHost='localhost'`, `10.0.0.1`, etc. — assert error.

### T4 — Fix CR-21 (6 spec-mandated missing tests)

**Test 1: Content sanitizer edge cases**
- `packages/mail/src/content-sanitizer.test.ts`:
  - >100KB inline data-URI image → stripped
  - <100KB inline data-URI image → kept
  - Tracking pixel with Quiksend tracking domain + non-tracking external image → tracking stripped, other kept
  - `preferPlainText` with minimal "Hi" text + full HTML → keeps HTML (per CR-29 fix)

**Test 2: Gateway single detect + sweep**
- `apps/worker/src/handlers/gateway-detect.test.ts` — extend:
  - `gateway.detect_single` cache-hit path (populate cache, invoke handler, assert no DNS call)
  - `gateway.detect_single` cache-miss path (empty cache, invoke, assert DNS + cache write)
  - `gateway.sweep_stale` (insert expired `gateway_classification` row, run sweep, assert re-classified)

**Test 3: Per-group auto-pause**
- `apps/worker/src/handlers/canary-check.test.ts` (OMICRON's file — coordinate):
  - Or new file `apps/worker/src/deliverability/auto-pause-orchestrator.test.ts` if OMICRON extracts logic
  - Seed canary_send rows across 2 sequences × 2 mailboxes × 2 gateways
  - Only one (sequence, mailbox, gateway) tuple breaches threshold
  - Assert only that sequence pauses

**Test 4: Deliverability snapshot rollup**
- `apps/worker/src/handlers/deliverability-snapshot.test.ts` (RHO's file — coordinate; likely already added by RHO):
  - Or extend from RHO's stub
  - Seed canary_send with mixed arrival_status
  - Call `refreshDeliverabilitySnapshots(7)`, `refreshDeliverabilitySnapshots(14)`, `refreshDeliverabilitySnapshots(30)`
  - Assert snapshot row counts + deliverability_pct math

**Test 5: Seed crypto round-trip**
- NEW `packages/mail/src/seed-crypto.test.ts`:
  - Encrypt seed IMAP config with `MAILBOX_ENCRYPTION_KEY` for user seed
  - Encrypt with `SYSTEM_SEED_ENCRYPTION_KEY` for provider seed (org_id=NULL)
  - Decrypt round-trip works for each
  - Cross-key decryption fails (user key can't decrypt provider config)

**Test 6: `gateway-detection` load-test mode**
- Covered by CR-37 (T2 above)

### T5 — Fix CR-22 (APP_SCOPED_TABLES_TO_TRUNCATE)

`packages/db/src/testing.ts`:
- Append: `"canary_send"`, `"seed_inbox"`, `"deliverability_snapshot"` (order matters: canary_send has FK to seed_inbox, so canary_send before seed_inbox)
- Order sensitive: TRUNCATE ... CASCADE would work but explicit order is safer

### T6 — Fix CR-27 (remove orphaned canary effect kinds)

`packages/core/src/state-machine/types.ts`:
- Remove `send_canary` and `emit_canary_bundle` from the `Effect` union

`packages/core/src/state-machine/transition.ts`:
- Verify no production code produces these effect kinds (grep repo-wide)
- Remove any switch arms for these kinds

`apps/worker/src/sequence/effects.ts`:
- Remove `handleSendCanary` function (dead code after removal)
- Remove any `case "send_canary":` or `case "emit_canary_bundle":` branches

`apps/web/src/lib/effect-executor.ts`:
- Remove no-op case branches for `emit_canary_bundle`

Verify OMICRON's canary path is 100% enrollment-time-enqueue (`enqueue("canary.send")`) — no state machine path.

### T7 — Fix CR-28 (SEG gateway allowlist code dedup)

Choose ONE canonical location for the SEG allowlist. Recommendation: `packages/core/src/deliverability/mailbox-safety.ts` already has `SEG_GATEWAYS` — make it canonical.

- `packages/mail/src/gateway-detect.ts` — remove local `SEG_GATEWAYS` `Set`, import from `@quiksend/core/deliverability`
- `packages/core/src/deliverability/canary-config.ts` — remove `SEG_GATEWAY_VALUES`, use `SEG_GATEWAYS` from mailbox-safety
- `apps/web/src/components/gateway-badge.tsx` — remove local `SEG_GATEWAYS`, import from core

Ensure imports use `import type` for type-only cases.

### T8 — Fix CR-29 (preferPlainText completeness heuristic)

`packages/mail/src/content-sanitizer.ts:97-98`:
- Current: drops HTML on any non-empty text
- Fix: drop HTML only if plain-text length ≥ fraction (e.g. 50%) of stripped-HTML text length
- OR: expose an explicit `textIsComplete: boolean` flag from composer

Simpler: heuristic — `if (text.trim().length >= stripHtml(html).length * 0.5) { drop HTML }`

Update test: minimal "Hi" plain-text + long HTML → keep HTML now.

### T9 — Fix CR-32 (dead exports cleanup)

- `apps/worker/src/deliverability/canary-send.ts:184-186`: remove `newCanaryToken` export if unused
- `packages/mail/src/content-sanitizer.ts:82-102`: verify if `sanitizeForSegAsync` should be wired (T1 discussion). If it stays unwired, remove or explicitly mark as `@deprecated`
- `apps/worker/src/handlers/gateway-detect.ts:12-17`: replace local `extractDomain` with `import { extractDomain } from "@quiksend/mail/gateway-detect"` (verify export exists in mail package)

### T10 — Fix CR-33 (gatewayClassification empty relations)

`packages/db/src/schema/deliverability.ts`: add an explicit empty relations block:

```typescript
export const gatewayClassificationRelations = relations(gatewayClassification, () => ({}));
```

For consistency with sibling tables. No functional impact.

### T11 — Fix CR-36 (test suite runtime — note only)

Add to a backlog note or CI tuning follow-up. Options:
- Vitest `pool: forks` in vitest.config.ts to parallelize import cost
- Split worker integration tests into a separate CI job

Note: fine to leave for now. Add a comment in vitest.config.ts noting the target.

### T12 — Fix CR-38 (entry conditions combined test)

`packages/core/src/state-machine/entry-conditions.test.ts` — add:
```typescript
it("if_no_reply short-circuits over gateway predicate", () => {
  const result = evaluateEntryCondition(
    { kind: "if_no_reply", recipientGatewayIn: ["proofpoint"] },
    { hasReplyOnThread: true, recipientGateway: "proofpoint" }
  );
  expect(result.proceed).toBe(false);
  expect(result.skipReason).toBe("has_reply_on_thread");
});
```

Confirm expected behavior first — read `entry-conditions.ts` to verify predicate ordering.

## Files owned (strict)

- `apps/worker/src/handlers/seed-pool-health.ts` (NEW)
- `apps/worker/src/handlers/seed-pool-health.test.ts` (NEW)
- `apps/worker/src/handlers/seed-pool-legit-mail.ts` (NEW)
- `apps/worker/src/handlers/seed-pool-legit-mail.test.ts` (NEW)
- `apps/worker/src/handlers/seed-inbox-verify.ts` (add host validation)
- `apps/web/src/lib/seed-inbox.functions.ts` — `createUserSeedInbox` only (CR-19). SIGMA owns `listSeedInboxes` (CR-31). Both add narrow patches.
- `apps/web/src/lib/seed-inbox.functions.test.ts` (extend for CR-19 tests)
- `apps/worker/src/index.ts` (register 2 new handlers)
- `packages/queue/src/jobs.ts` (register 2 new job types)
- `scripts/load-test-engine.ts` (CR-11, CR-37 — load-test modes)
- `packages/db/src/testing.ts` (CR-22 — truncate list)
- `packages/mail/src/content-sanitizer.ts` (CR-29)
- `packages/mail/src/content-sanitizer.test.ts` (extend for CR-21)
- `packages/mail/src/seed-crypto.test.ts` (NEW — CR-21)
- `packages/mail/src/gateway-detect.ts` (CR-32 — extractDomain export cleanup)
- `packages/mail/src/gateway-fingerprints.json` — read only
- `packages/core/src/deliverability/mailbox-safety.ts` (CR-28 — becomes canonical)
- `packages/core/src/deliverability/canary-config.ts` (CR-28 — import from mailbox-safety)
- `packages/core/src/state-machine/types.ts` (CR-27)
- `packages/core/src/state-machine/transition.ts` (CR-27)
- `packages/core/src/state-machine/entry-conditions.test.ts` (CR-38)
- `apps/worker/src/sequence/effects.ts` (CR-27 — remove handleSendCanary)
- `apps/web/src/lib/effect-executor.ts` (CR-27 — remove no-op cases)
- `apps/web/src/components/gateway-badge.tsx` (CR-28 — import from core)
- `apps/worker/src/handlers/gateway-detect.ts` — extractDomain reuse only (CR-32). RHO owns the handler logic. Coordinate.
- `packages/db/src/schema/deliverability.ts` — empty relations for gatewayClassification only. OMICRON + RHO also touch this file for other reasons.

## Do NOT touch

- Canary internals (`canary-send.ts`, `canary-check.ts`, `seed-imap.ts`, `canary-injection.ts`) — OMICRON
- `apps/worker/src/handlers/gateway-detect.ts` main logic — RHO
- `apps/worker/src/handlers/deliverability-snapshot.ts` — RHO
- `packages/mail/src/dns.ts` — RHO
- `apps/web/src/lib/prospects.functions.ts` — RHO owns `classifyEmail`
- `apps/web/src/lib/deliverability.functions.ts` — RHO
- `apps/web/src/routes/**` — SIGMA
- `apps/worker/src/handlers/webhook-fanout.ts` + `execute-effects.ts` — SIGMA
- `docs/*.md` — SIGMA
- `internal-runbooks/*.md` — SIGMA
- `packages/db/src/schema/api.ts` — SIGMA
- `packages/db/drizzle/00XX_*.sql` — OMICRON (0019), RHO (0020)

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
pnpm tsx scripts/load-test-engine.ts --test-mode=canary-happy-path
pnpm tsx scripts/load-test-engine.ts --test-mode=canary-auto-pause
pnpm tsx scripts/load-test-engine.ts --test-mode=gateway-detection
```

Manual smoke:
- Boot worker → verify seed_pool.* jobs registered in pg-boss
- Attempt to create user seed inbox with `imapHost='10.0.0.1'` → verify validation error
- Run load-test canary modes → verify assertions pass

## Result

```json
{
  "status": "ok",
  "track": "PHI2",
  "findings_addressed": ["CR-09", "CR-11", "CR-19", "CR-21", "CR-22", "CR-27", "CR-28", "CR-29", "CR-32", "CR-33", "CR-36", "CR-37", "CR-38"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
