# TRACK TAU — Phase 11A: Detection + Segmentation

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/wave7-tau-detection` from `main` (worktree isolated).

**Foundation wave has already merged.** The shared enums + column additions + type
stubs are in place. You implement the real detection logic on top.

## Context (read in order)
1. `CLAUDE.md`
2. `wave7/WAVE_CONTEXT.md` — file-ownership boundaries
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Phase 11A (full section, this is your bible)
4. `packages/mail/src/gateway-detect.ts` — the Foundation stub you replace with real implementation
5. `packages/mail/src/dns.ts` — Phase 4 checkers you extend with MX resolution
6. `packages/core/src/state-machine/entry-conditions.ts` — Wave 5 BETA's pure evaluator you extend
7. `apps/web/src/lib/prospects.functions.ts` — Wave 5 BETA + DELTA extended this; you extend further additively
8. `apps/worker/src/handlers/mailbox-poll.ts` — DELTA extended for Graph pagination; pattern reference for new handler
9. `apps/web/src/lib/analytics.functions.ts` — Wave 6 OMEGA's `withAnalyticsTiming`; use for new read paths
10. `packages/queue/src/jobs.ts` — Wave 5 EPSILON's `enqueueWithRetries` pattern

## Tickets from Phase 11 spec (11A.1 through 11A.11)

### 11A.1 — Migration
NEW table `gateway_classification`. See spec § Phase 11A Data model for exact
schema. Also enum `gateway_classification_confidence`. Run `pnpm db:generate --name
phase11a_gateway_classification`. Migration slot 0016.

### 11A.2 — `packages/mail/src/gateway-detect.ts` real implementation
Replace the Foundation stub with the detection cascade. See spec § Phase 11A
Mechanics for the full algorithm:
1. MX lookup via `node:dns/promises.resolveMx`
2. Match against the fingerprint table
3. If MX ambiguous, check DMARC + SPF for evidence
4. Fall back to `unknown` after exhausting the cascade
5. Return `{ gateway, evidence, confidence, mxRecords }`

**Split-brain case (spec critical)**: If the MX chain has BOTH a SEG (e.g. Proofpoint's
MX) AND a downstream storage provider (e.g. Google Workspace), return the SEG. That's
the actively-filtering hop. Include both in `evidence[]` for clarity.

Unit tests exhaustively covering:
- Each of the 8 SEG fingerprints
- `google_workspace` (aspmx.l.google.com pattern)
- `microsoft_365` (mail.protection.outlook.com pattern)
- Split-brain (Proofpoint MX + Google storage)
- MX lookup timeout → returns `unknown` with `confidence: low`
- DNS SERVFAIL → returns `unknown`
- Empty MX (misconfigured domain) → returns `unknown`

### 11A.3 — Fingerprint table externalization
Extract `MX_FINGERPRINTS` from `gateway-detect.ts` code into
`packages/mail/src/gateway-fingerprints.json`. Loaded at module init with schema
validation via Zod. Provides git-diffable audit trail when adding new patterns.

Fingerprint list (from spec):

```json
[
  { "pattern": "\\.pphosted\\.com$", "gateway": "proofpoint", "confidence": "high" },
  { "pattern": "\\.ppe-hosted\\.com$", "gateway": "proofpoint", "confidence": "high" },
  { "pattern": "\\.mimecast\\.com$", "gateway": "mimecast", "confidence": "high" },
  { "pattern": "\\.mimecast\\.co\\.[a-z]+$", "gateway": "mimecast", "confidence": "high" },
  { "pattern": "\\.barracudanetworks\\.com$", "gateway": "barracuda", "confidence": "high" },
  { "pattern": "\\.essentialscloud\\.com$", "gateway": "barracuda", "confidence": "high" },
  { "pattern": "\\.iphmx\\.com$", "gateway": "cisco_ironport", "confidence": "high" },
  { "pattern": "tmes\\.trendmicro\\.com$", "gateway": "trend_micro", "confidence": "high" },
  { "pattern": "\\.fortimail\\.com$", "gateway": "fortinet", "confidence": "high" },
  { "pattern": "\\.mail\\.sophos\\.com$", "gateway": "sophos", "confidence": "high" },
  { "pattern": "messagelabs\\.com$", "gateway": "symantec", "confidence": "high" },
  { "pattern": "symantec\\.cloud$", "gateway": "symantec", "confidence": "high" },
  { "pattern": "aspmx\\.l\\.google\\.com$", "gateway": "google_workspace", "confidence": "high" },
  { "pattern": "\\.googlemail\\.com$", "gateway": "google_workspace", "confidence": "high" },
  { "pattern": "\\.mail\\.protection\\.outlook\\.com$", "gateway": "microsoft_365", "confidence": "high" },
  { "pattern": "\\.outlook\\.com$", "gateway": "microsoft_365", "confidence": "high" },
  { "pattern": "zoho\\.com$", "gateway": "zoho", "confidence": "high" },
  { "pattern": "zohomail\\.com$", "gateway": "zoho", "confidence": "high" },
  { "pattern": "messagingengine\\.com$", "gateway": "fastmail", "confidence": "high" }
]
```

### 11A.4 — Worker handlers
`apps/worker/src/handlers/gateway-detect.ts` — 4 handlers:

- `gateway.detect_single { email }` — classify one email, populate the cache + prospect
- `gateway.detect_bulk { emails: string[] }` — batch classify, respects DNS semaphore (50 concurrent)
- `gateway.apply_classification { organizationId?, domain? }` — back-fill prospect rows from cache
- `gateway.sweep_stale` — daily cron; re-classify entries past TTL

All idempotent. Use `enqueueWithRetries` for retryable enqueue (5 attempts, exponential backoff to 3600s).

Register handlers in `apps/worker/src/index.ts` following the existing pattern from `crm-writeback` + `mailbox-poll`.

### 11A.5 — Server functions (all `orgFn`-wrapped)
Add to `apps/web/src/lib/prospects.functions.ts` (extends additively):
- `classifyEmail({ email })` — synchronous cache read, enqueues background if miss
- `reclassifyDomain({ emailDomain })` — admin role gate
- `getGatewayMixForOrg({})` — feeds workspace overview card
- `getGatewayMixForList({ listId })`
- `getGatewayMixForSequence({ sequenceId })`

Wrap reads with `withAnalyticsTiming` (import from `analytics.functions.ts`).

### 11A.6 — Prospect create/import wiring
`createProspect` server-fn (existing) → enqueue `gateway.detect_single` after insert.
`apps/worker/src/handlers/import-prospects.ts` (DELTA's Wave-5 handler) → enqueue
`gateway.detect_bulk` after bulk upsert.

### 11A.7 — Extend `entry-conditions.ts`
Extend `EntryConditionSchema` with two optional fields:
```typescript
recipientGatewayIn: z.array(GatewayTypeSchema).optional(),
recipientGatewayNotIn: z.array(GatewayTypeSchema).optional(),
```

Extend `EnrollmentContextForCondition` with `recipientGateway: EmailGateway | null`.

Extend `evaluateEntryCondition` with the two new branches. Return `{ proceed: false, skipReason: "recipient_gateway_not_in_allow_list" }` or `"recipient_gateway_in_deny_list"` as appropriate.

Update `evaluateEntryCondition.test.ts` with new predicate branches.

### 11A.8 — UI: prospect badge + list filter + list detail bar chart
- Prospect card + list row: shadcn `Badge` with gateway name + color (Proofpoint=red, Mimecast=orange, M365=blue, Google Workspace=green, unknown=gray). Tooltip shows evidence.
- Prospect list filter chip: multi-select gateway filter using shadcn `Popover + Command + CheckboxItem`
- List detail page (`_protected/prospects/lists/$id.tsx` if exists, else prospects index): horizontal stacked bar chart via Recharts showing SEG mix percentages

### 11A.9 — UI: sequence step editor
`apps/web/src/routes/_protected/sequences/$id/edit.tsx` — extend the entry-condition
picker (from Wave 5 BETA COMP-005) with two new multi-select fields:
- "Only send if recipient is behind: [multi-select]" (`recipientGatewayIn`)
- "Never send if recipient is behind: [multi-select]" (`recipientGatewayNotIn`)

### 11A.10 — UI: workspace overview + sequence detail
- Workspace overview: new card "Prospect gateway mix" below existing overview. Recharts horizontal bar. "% classified" counter.
- Sequence detail: new "Deliverability outlook" panel. SEG mix of enrolled prospects. Warning if any prospects behind SEGs.

### 11A.11 — Integration test
`apps/worker/src/handlers/gateway-detect.test.ts` — full lifecycle test with mocked
`resolveMx`. Import 200 prospects across 20 domains, wait for classification, assert
all rows populated.

## Documentation lookup (mandatory)
Context7 MCP for:
- **`node:dns/promises`** — `resolveMx` signature, error types, timeout handling
- **Drizzle ORM** — jsonb `$type<T[]>()`, unique indexes with WHERE clauses
- **pg-boss v12** — job type registration, `deleteAllJobs` behavior
- **TanStack Router** — data-loading in the new sequence detail panel

## Files owned (strict)

- `packages/db/src/schema/prospects.ts` (extends prospect further — the shape only, no columns)
- `packages/db/src/schema/deliverability.ts` (NEW — `gateway_classification` table)
- `packages/db/src/schema/index.ts` (barrel)
- `packages/db/drizzle/0016_phase11a_gateway_classification.sql` (renumbers if merge order shifts)
- `packages/mail/src/gateway-detect.ts` (REAL implementation, replacing Foundation stub)
- `packages/mail/src/gateway-detect.test.ts` (NEW)
- `packages/mail/src/gateway-fingerprints.json` (NEW)
- `packages/mail/src/dns.ts` (extends with `resolveMx` helper if not already there)
- `packages/core/src/state-machine/entry-conditions.ts` (extends)
- `packages/core/src/state-machine/entry-conditions.test.ts` (extends)
- `apps/worker/src/handlers/gateway-detect.ts` (NEW)
- `apps/worker/src/handlers/gateway-detect.test.ts` (NEW)
- `apps/worker/src/handlers/import-prospects.ts` (extends additively — DELTA's file, be surgical)
- `apps/worker/src/index.ts` (register 4 new handlers)
- `apps/web/src/lib/prospects.functions.ts` (extends — BETA + DELTA also extended; be surgical, add at end)
- `apps/web/src/routes/_protected/prospects/$id.tsx` (badge display on detail page)
- `apps/web/src/routes/_protected/prospects/index.tsx` (badge on list + filter chip)
- `apps/web/src/routes/_protected/sequences/$id/edit.tsx` (step editor extension)
- `apps/web/src/routes/_protected/sequences/$id/index.tsx` (deliverability outlook panel — coordinate with UPSILON + PHI who add adjacent sections)
- `apps/web/src/routes/_protected/index.tsx` (workspace overview card)

## Do NOT touch

- `packages/db/src/schema/mail.ts` — UPSILON extends mailbox
- `packages/mail/src/content-sanitizer.ts` — UPSILON owns
- `apps/worker/src/sequence/**` — UPSILON owns reserve-slot + effects + mailbox-router
- `apps/worker/src/handlers/canary-check.ts` — PHI owns
- `apps/web/src/lib/mailboxes.functions.ts` — UPSILON
- `apps/web/src/routes/_protected/settings/deliverability.tsx` — UPSILON creates
- `apps/web/src/routes/_protected/deliverability/**` — PHI owns
- `packages/core/src/state-machine/transition.ts` — UPSILON + PHI extend (adjacent branches); you only add new event kinds if necessary and they must not collide

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
pnpm tsx scripts/load-test-engine.ts  # still passes
```

Manual smoke:
- Import a small CSV covering all major SEGs (real MX lookups) via `pnpm db:seed` extension or a test CLI
- Verify badges render with correct colors
- Configure a sequence step with `recipientGatewayIn: ["proofpoint"]`; enroll prospects with mixed gateways; verify only Proofpoint prospects have that step run (state machine emits `skipReason` for others)

## Result

```json
{
  "status": "ok",
  "track": "TAU",
  "phase_section": "11A",
  "tickets_completed": ["11A.1", "11A.2", ..., "11A.11"],
  "tickets_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
