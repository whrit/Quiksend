# TRACK RHO — Performance + Gateway Detection Cache + DNS Security

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave8-rho-perf` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave8/WAVE_CONTEXT.md`
3. `phase11-review/CONSOLIDATED.md`
4. `phase11-review/findings/performance.md` § PERF-001, 002, 006, 007, 008, 009, 010, 011, 012, 013, 014
5. `phase11-review/findings/security.md` § SEC-P11-002, SEC-P11-003
6. `phase11-review/findings/correctness.md` § CORR-006
7. `apps/worker/src/handlers/gateway-detect.ts`
8. `apps/worker/src/handlers/deliverability-snapshot.ts`
9. `packages/mail/src/dns.ts`
10. `apps/web/src/lib/prospects.functions.ts` § `classifyEmail`

## Findings assigned (9 CRs)

### High (3)
- **CR-06** — Bulk gateway detection skips DB cache (both `detect_bulk` + `detect_single`)
- **CR-07** — `apply_classification` does 5,000 per-row UPDATEs instead of bulk
- **CR-15** — Deliverability snapshot hardcoded 7-day window; grid supports 14/30 selectors

### Medium (4)
- **CR-18** — DNS gateway classification has no domain allowlist + `classifyEmail` open to any member
- **CR-23** — Missing `canary_send(sent_at)` index for silent-drop sweep + missing seed_inbox indexes
- **CR-24** — `maybePauseCampaigns` N+1: per-row sequence + org metadata fetches
- **CR-25** — Pending-canary query unbounded + no DMARC/SPF TXT timeout + no idle seed heartbeat / IMAP pool

### Low (2)
- **CR-34** — `pickLeastLoadedSafeMailbox` runs N reservation COUNTs inside advisory lock (informational — note in fix or accept)
- **CR-35** — `enterprise_safe` routing filter no dedicated index (informational — note)

## Documentation lookup (mandatory)
Context7 MCP for:
- **Drizzle ORM** — `inArray`, `WHERE ANY($1)`, bulk UPDATE with `CASE` or CTE, `db.execute(sql\`\`)` for SQL fragments, partial index syntax
- **PostgreSQL** — batch UPDATE with `FROM (VALUES ...) AS v(id, val)` pattern, EXPLAIN plan for advisory lock scope

## Tasks

### T1 — Fix CR-06 (cache lookup in `detect_bulk` + `detect_single`)

`apps/worker/src/handlers/gateway-detect.ts`:

**`gateway.detect_bulk`** handler:
1. After the initial `Set(domains)` dedupe (~line 125-129), batch SELECT: `db.select({ emailDomain, gateway, confidence, evidence, mxRecords, ttlUntil }).from(tables.gatewayClassification).where(and(inArray(...), gt(tables.gatewayClassification.ttlUntil, sql\`now()\`)))`
2. Build a `Set<string>` of cached-fresh domains
3. Only `classifyDomain()` for domains NOT in the cached set
4. For domains in the cached set, skip DNS entirely and use the cached classification directly

**`gateway.detect_single`** handler:
1. Same pattern: SELECT the domain from cache first
2. If found + fresh → `applyClassificationToProspects` + return
3. Else → run cascade

Pattern already correct in `apply_classification` (`gateway-detect.ts:170-177`) — mirror it.

### T2 — Fix CR-07 (bulk UPDATE in `apply_classification`)

`apps/worker/src/handlers/gateway-detect.ts:179-200`:
- REMOVE the per-row UPDATE loop
- Group prospects by their domain's classification result
- Call `applyClassificationToProspects` (existing at `:56-80`) once per domain — that helper already does a domain-scoped bulk UPDATE
- Enqueue missing domains as ONE bulk `gateway.detect_bulk` job with all missing domains, not per-prospect `detect_single`

### T3 — Fix CR-15 (snapshot windowing 7/14/30)

`apps/worker/src/handlers/deliverability-snapshot.ts`:
- Parameterize `refreshDeliverabilitySnapshots(windowDays: 7 | 14 | 30)`
- The 15-min cron runs the refresh for all 3 windows: `await Promise.all([refresh(7), refresh(14), refresh(30)])`
- `window_start` = `date_trunc('day', now() - interval '${windowDays} days')`
- Snapshot upsert key includes `windowDays` (may need schema change — coordinate with OMICRON's migration slot 0019)

`apps/web/src/lib/deliverability.functions.ts` `getDeliverabilityGrid`:
- Filter `snapshots WHERE window_days = ${input.windowDays}`
- Existing behavior for 14/30 will now return actual 14/30-day rollups

If schema change needed: add `windowDays: integer("window_days").default(7).notNull()` to `deliverability_snapshot` in a new migration `0020_wave8_rho_perf_indexes.sql` (or 0021 if OMICRON takes 0019). Include the CR-23 indexes in the same migration.

### T4 — Fix CR-18 (DNS domain validation + rate limit for classifyEmail)

**Sub-task 4a**: `packages/mail/src/gateway-detect.ts` `detectEmailGateway`:
- Before `resolveMxRecords(domain)`, validate domain shape:
  - Reject invalid labels (RFC 1035: labels max 63 chars, total 253 chars, allowed chars)
  - Reject single-label hosts unless in a whitelist (e.g. `localhost` — reject)
  - Reject `.local`, `.internal`, `.test`, `.example`, `.invalid` (RFC 6761 special-use)
  - Reject bare IP addresses (they're not domains)
  - Return `{ gateway: 'unknown', evidence: [{kind:'heuristic', detail:'blocked domain shape'}], confidence: 'low' }` on rejection

**Sub-task 4b**: `apps/web/src/lib/prospects.functions.ts` `classifyEmail`:
- Add `requireAdmin` OR add per-org daily rate limit (100 classifications/day/org)
- The spec goal is "prevent DNS oracle abuse by low-privileged members"
- If admin gate: use existing pattern from other admin-gated server-fns; leave a UI note that classification for own prospects works automatically via detect_single-on-create

### T5 — Fix CR-23 (missing indexes migration)

Migration `0020_wave8_rho_perf_indexes.sql` (or 0021):

```sql
-- Silent-drop sweep support
CREATE INDEX canary_send_pending_sent_at_idx
  ON canary_send (sent_at)
  WHERE arrival_status = 'pending' AND sent_at IS NOT NULL;

-- Seed inbox lookups
CREATE INDEX seed_inbox_org_active_idx
  ON seed_inbox (organization_id, active);

CREATE INDEX seed_inbox_provider_gateway_active_idx
  ON seed_inbox (gateway, active)
  WHERE organization_id IS NULL;
```

Optional (CR-35 low): partial index for enterprise-safe routing filter.
Optional (PHI2's tests will need this): index on `canary_send(sequence_id, mailbox_id)` for `maybePauseCampaigns`.

### T6 — Fix CR-24 (`maybePauseCampaigns` batch-load)

`apps/worker/src/handlers/canary-check.ts:156-191` — BUT this file is OMICRON's territory. YOU touch only the specific `maybePauseCampaigns` function OR extract it to a new module.

Preferred: extract `maybePauseCampaigns` to `packages/core/src/deliverability/auto-pause.ts` (pure helper) + orchestration in a new file `apps/worker/src/deliverability/auto-pause-orchestrator.ts` that YOU own.

Actually — simpler: since OMICRON is doing a big refactor of `canary-check.ts` anyway, coordinate via `NEEDS.md`:
1. Write your batch-load implementation as a suggested code block in `wave8/logs/wave8-rho-perf/NEEDS.md`
2. OMICRON incorporates it during their refactor

OR: OMICRON hands off `canary-check.ts:156-191` region to RHO after their refactor. Simplest: RHO opens the PR after OMICRON, applies the batch-load as a follow-up.

**Best option for parallelism**: extract to a new module you own:
- `apps/worker/src/deliverability/auto-pause-batch-loader.ts` — batch-loads sequences + org metadata for a list of `(sequence_id, mailbox_id, gateway)` groups
- Signature: `loadPauseContext(groups: Array<{ sequenceId: string; ... }>) => Promise<Map<string, PauseContext>>`
- Uses `inArray` for both sequence + organization lookups
- OMICRON imports it in their refactor

### T7 — Fix CR-25 (pending-canary bound + TXT timeout + idle heartbeat + IMAP pool)

**Sub-task 7a**: TXT timeout in `packages/mail/src/dns.ts`:
- Wrap `resolveTxtRecords` in the same `Promise.race` + timeout pattern as `resolveMxRecords` (`dns.ts:15-28`)
- Default 5s, configurable via env if desired

**Sub-task 7b**: Pending-canary query LIMIT. This is in `canary-check.ts` (OMICRON territory). Write to `NEEDS.md` for OMICRON: "add `.limit(500)` to pending canary query; process in batches ordered by `expected_arrival_at`".

**Sub-task 7c**: IMAP pool + idle heartbeat. Extract IMAP connection pooling to a new module you own: `apps/worker/src/deliverability/imap-pool.ts` — pool per `seedInboxId` with 15-min idle TTL, max 20 connections. OMICRON's seed-imap.ts imports it.

Coordinate via `NEEDS.md` with OMICRON on the module interface.

### T8 — Note CR-34 + CR-35 (low, informational)

Both are noted as fine at current scale. Add a comment in `mailbox-router.ts` and `mail.ts` schema referencing the review CR-# and the scale threshold. No index changes needed.

## Documentation

Add a short note to `docs/deliverability.md` (SIGMA owns the file; write your suggested addition in `NEEDS.md`):

> Gateway classification cache: domains cached for 30 days (high/medium confidence),
> 7 days (low confidence), 24 hours (unknown). Force reclassify via
> Settings → Prospects for admin users; automatic on prospect create.

## Files owned (strict)

- `apps/worker/src/handlers/gateway-detect.ts` (CR-06, CR-07)
- `apps/worker/src/handlers/gateway-detect.test.ts` (extend for CR-06/07 coverage)
- `apps/worker/src/handlers/deliverability-snapshot.ts` (CR-15)
- `apps/worker/src/handlers/deliverability-snapshot.test.ts` (NEW test)
- `apps/worker/src/deliverability/auto-pause-batch-loader.ts` (NEW — CR-24)
- `apps/worker/src/deliverability/auto-pause-batch-loader.test.ts` (NEW)
- `apps/worker/src/deliverability/imap-pool.ts` (NEW — CR-25)
- `apps/worker/src/deliverability/imap-pool.test.ts` (NEW)
- `packages/mail/src/dns.ts` (CR-25 TXT timeout)
- `packages/mail/src/dns.test.ts` (extend)
- `packages/mail/src/gateway-detect.ts` — domain validation ONLY (add validation function + call before resolveMx). PHI2 also touches this file for `extractDomain` export — coordinate at merge
- `apps/web/src/lib/prospects.functions.ts` — ONLY `classifyEmail` admin gate/rate limit
- `packages/db/src/schema/deliverability.ts` — indexes only; NOT `stepIndex` column (OMICRON)
- `packages/db/drizzle/0020_wave8_rho_perf_indexes.sql` (migration; renumber if merge shifts)
- `apps/web/src/lib/deliverability.functions.ts` — `getDeliverabilityGrid` window filter only

## Do NOT touch

- `apps/worker/src/deliverability/canary-send.ts` — OMICRON
- `apps/worker/src/deliverability/seed-imap.ts` — OMICRON
- `apps/worker/src/handlers/canary-check.ts` — OMICRON (coordinate via NEEDS.md)
- `apps/web/src/lib/canary-injection.ts` — OMICRON
- `packages/core/src/state-machine/*` — PHI2
- `packages/core/src/deliverability/mailbox-safety.ts` + related SEG allowlist files — PHI2 (CR-28 dedup)
- `packages/mail/src/content-sanitizer.ts` — PHI2 (CR-29)
- `apps/web/src/routes/**` — SIGMA
- `docs/*.md` + `internal-runbooks/*.md` — SIGMA (write suggestions to NEEDS.md)
- Provider seed pool handlers — PHI2
- `packages/db/src/schema/api.ts` — SIGMA
- `packages/queue/src/jobs.ts` — PHI2 (registers new seed_pool jobs)

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check
```

Manual perf smoke:
- Import 200 prospects with 20 unique domains twice; verify second run makes 0 DNS calls (cache hit)
- Enqueue 1000 prospects for bulk apply; verify < 5s total DB time (bulk UPDATE)
- Verify EXPLAIN uses new indexes for silent-drop sweep query + seed_inbox provider query

## Result

```json
{
  "status": "ok",
  "track": "RHO",
  "findings_addressed": ["CR-06", "CR-07", "CR-15", "CR-18", "CR-23", "CR-24", "CR-25", "CR-34", "CR-35"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
