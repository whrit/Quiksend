# TRACK PHI — Phase 11C: Canary Deliverability (code)

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/wave7-phi-canary` from `main` (worktree isolated).

**Foundation wave has already merged.** The shared enums + `mailbox-safety.ts` helper +
type stubs are in place. You implement the canary injection + polling + auto-pause + UI grid.

**OMEGA-OPS runs in parallel** — they handle the provider seed pool operational setup
(domain purchase, per-SEG subscription, DB bootstrap). Your job is the CODE; theirs
is the OPERATIONS. Your code must support both user-provided seeds (any workspace) and
provider-managed seeds (Deliverability Pro tier gate).

## Context (read in order)
1. `CLAUDE.md`
2. `wave7/WAVE_CONTEXT.md` — file-ownership boundaries
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Phase 11C (full section — includes the provider pool mechanics you code against)
4. `packages/core/src/deliverability/mailbox-safety.ts` — Foundation's helper
5. `packages/mail/src/mime.ts` — Wave 4 + you extend for `X-Quiksend-Canary-Id` header
6. `apps/worker/src/handlers/mailbox-poll.ts` — DELTA's Microsoft delta poll; pattern for IMAP polling reuse
7. `apps/worker/src/sequence/effects.ts` — Wave 5 ALPHA's effect executor; extends for canary send handling
8. `apps/web/src/lib/effect-executor.ts` — Wave 6 OMEGA's shared executor; extends for `emit_canary_bundle` kind
9. `apps/web/src/lib/sequences.functions.ts` — Wave 5 BETA's `enrollProspects` you extend for canary injection

## Tickets from Phase 11 spec (11C.1 through 11C.14, backend + UI)

### 11C.1 — Migration
NEW tables:
- `seed_inbox` (org-scoped when user-provided, `organization_id = NULL` when provider-managed)
- `canary_send` (org-scoped)
- `deliverability_snapshot` (org-scoped)
Enums come from Foundation. See spec § Consolidated entity map for exact columns.

Additional extensions:
- `sequence.canary_config jsonb` — per-sequence override

Migration slot 0018. Runs after Foundation (0015), TAU (0016), UPSILON (0017).

### 11C.2 — Seed inbox CRUD server-fns
`apps/web/src/lib/seed-inbox.functions.ts` (NEW file):
- `listSeedInboxes({})` — user's own + provider-managed (if Pro entitled)
- `createUserSeedInbox({ email, imapHost, ..., useSsl, notes? })` — encrypts credentials with `MAILBOX_ENCRYPTION_KEY`
- `verifySeedInbox({ seedInboxId })` — force re-verify
- `deleteSeedInbox({ seedInboxId })` — user seeds only, cascades canary_send rows
- `toggleSeedInboxActive({ seedInboxId, active })`
- `isEntitledToProviderSeeds({})` — reads `organization.metadata.entitlements.deliverability_pro.activeUntil`

Admin role gate on write ops.

### 11C.3 — Seed inbox IMAP verification handler
`apps/worker/src/handlers/seed-inbox-verify.ts` — enqueued on create. IMAP LOGIN +
LIST to confirm credentials work. Sets `verified_at`. Retry 3× with exponential
backoff before marking `active = false`.

### 11C.4 — Canary injection in `enrollProspects`
Extend `apps/web/src/lib/sequences.functions.ts` `enrollProspects` server-fn:
1. Read workspace + sequence canary config
2. Compute SEG mix of enrollment batch
3. For each SEG with count >= 5 (default threshold): pick `seedsPerCampaign` seeds (user's first, provider if Pro), pick M random positions in the sequence, insert `canary_send` rows with `sent_at = NULL`, `expected_arrival_at = null` until scheduled

### 11C.5 — `buildMime` extension
Extend `packages/mail/src/mime.ts` `buildMime()` to accept optional `canaryToken: string`
that adds `X-Quiksend-Canary-Id: <token>` header. Unit test: MIME with canary token has the header; without it, no header.

### 11C.6 — `effects.ts` canary handling
Extend `apps/worker/src/sequence/effects.ts` to handle canary sends distinctly:
- Sender: same mailbox rotation as real prospects
- Recipient: seed inbox's email
- Content: **same body as an adjacent real send in the campaign** (rendered with placeholder identity values — `firstName: "Canary"`, etc.)
- Adds `X-Quiksend-Canary-Id: <token>` header via `buildMime` extension
- No CRM writeback, no sequence state advance for the canary — shadow send

**Coordinate with UPSILON**: they also extend `effects.ts` for the content sanitizer.
Adjacent hunks; take both branches on merge. Or you can NEEDS.md an insertion point
UPSILON must respect.

### 11C.7 — Canary polling worker
NEW `apps/worker/src/handlers/canary-check.ts`. Runs every 5 min via cron.
Full implementation per spec § Phase 11C Mechanics:
- Query pending canaries approaching expected arrival
- Group by seed inbox, one IMAP connection per seed
- Search by `X-Quiksend-Canary-Id` header
- Classify arrival: inbox / spam / quarantine / not_found / bounced
- Extract `Authentication-Results` + `Received` chain into `canary_send.arrival_gateway_headers`
- Sweep any canary > 24h without arrival → `silent_drop`

Register in `apps/worker/src/index.ts`. Cron pattern: `*/5 * * * *`.

### 11C.8 — Auto-pause evaluator
NEW module `packages/core/src/deliverability/auto-pause.ts` (pure, no I/O):

```typescript
export interface CanaryStats {
  sequenceId: string;
  mailboxId: string;
  gateway: EmailGateway;
  delivered: number;
  total: number;
}
export interface AutoPauseDecision {
  action: "pause" | "no_action";
  reason?: string;
  deliverabilityPct?: number;
  threshold?: number;
}
export function evaluateAutoPause(stats: CanaryStats, threshold: number): AutoPauseDecision;
```

Pure evaluator, exhaustively unit-tested. Called from `canary-check.ts` after every poll.

### 11C.9 — Deliverability snapshot refresh
Periodic rollup job `apps/worker/src/handlers/deliverability-snapshot.ts` — runs every
15 min. Aggregates `canary_send` into `deliverability_snapshot` per (org, mailbox,
gateway, window) tuple. Feeds the grid UI.

### 11C.10 — Server functions for grid + history
Add to `apps/web/src/lib/deliverability.functions.ts` (NEW file):
- `getDeliverabilityGrid({ windowDays: number })` — full shape per spec
- `getCanaryHistory({ sequenceId?, limit, cursor? })` — keyset paginated
- `getWorkspaceCanaryConfig({})`
- `setWorkspaceCanaryConfig({...})` — admin only
- `getProviderManagedSeedGateways({})` — Pro tier read

### 11C.11 — Seed inbox settings UI
NEW section on `apps/web/src/routes/_protected/settings/deliverability.tsx`:
UPSILON creates this file with the routing section. You extend it with a Seed Inboxes
section BELOW the routing section. Use the section boundary comment UPSILON leaves:

```tsx
{/* === Phase 11C Canary section (PHI extends here) === */}
<SeedInboxesSection />
<CanaryConfigSection />
{/* === End Phase 11C === */}
```

Table + "Add seed inbox" modal. If not Pro, banner "Add 4 more SEGs with Deliverability Pro".

### 11C.12 — Deliverability grid page
NEW route `apps/web/src/routes/_protected/deliverability/index.tsx`:
- Grid rows = mailboxes, cols = SEGs, cells = arrival % with sparkline
- Color-coded (green ≥90%, yellow 50-90%, red <50%, gray insufficient data)
- Time window selector (7/14/30 days)
- Click cell → drawer with canary history + evidence headers
- 30-second polling for live updates

### 11C.13 — Sequence detail live indicator
Extend `apps/web/src/routes/_protected/sequences/$id/index.tsx` — add a live
"Deliverability for this campaign: 94%" indicator. Red banner if < threshold.

**Coordinate with TAU + UPSILON** who also touch this file. Add your section AFTER
theirs; use a clear boundary comment.

### 11C.14 — Auto-pause notifications
- In-app: toast + persistent banner on sequence page
- Email: sent via `packages/mail/src/adapters/smtp` to workspace admins with details per spec

## Provider seed pool coordination with OMEGA-OPS

OMEGA-OPS runs in parallel. Their runbook produces the ops steps for provisioning
the pool. YOUR code makes it possible:

- `seed_inbox` table supports `organization_id = NULL` (provider-managed)
- `pool_tag` enum ('production' | 'canary_only' | 'warmup') exists
- IMAP credentials encrypted with `SYSTEM_SEED_ENCRYPTION_KEY` env var (add to
  `packages/config/src/env.schema.ts` as optional — Foundation didn't add this so
  YOU add it in this track)
- `scripts/seed-pool-bootstrap.ts` (NEW, from spec) — reads a config file
  (`internal-runbooks/seed-pool-config.example.json` — you ship the EXAMPLE, OMEGA-OPS
  ships the REAL config as a runbook artifact) and inserts rows into `seed_inbox`

Do NOT actually populate the pool. Just make the schema + code work.

## Documentation lookup (mandatory)
Context7 MCP for:
- **Drizzle ORM** — cursor-paginated queries, jsonb, DISTINCT ON, foreign keys with NULL support (org_id nullable in seed_inbox)
- **imap** or **imapflow** or **node-imap** — pick the library the worker already uses for `mailbox-poll.ts` and reuse. If none, `imapflow` is recommended
- **pg-boss v12** — job priority, cron schedule syntax

## Files owned (strict)

- `packages/db/src/schema/deliverability.ts` (extends — TAU created for gateway_classification; you add seed_inbox + canary_send + deliverability_snapshot)
- `packages/db/src/schema/sequences.ts` (extends — sequence.canary_config jsonb)
- `packages/db/drizzle/0018_phase11c_canary.sql` (renumbers if merge order shifts)
- `packages/mail/src/mime.ts` (extends buildMime for canary token)
- `packages/mail/src/mime.test.ts` (extends)
- `packages/core/src/deliverability/auto-pause.ts` (NEW pure evaluator)
- `packages/core/src/deliverability/auto-pause.test.ts` (NEW)
- `packages/core/src/state-machine/transition.ts` (extends — coordinate with UPSILON)
- `apps/worker/src/handlers/canary-check.ts` (NEW)
- `apps/worker/src/handlers/canary-check.test.ts` (NEW)
- `apps/worker/src/handlers/seed-inbox-verify.ts` (NEW)
- `apps/worker/src/handlers/deliverability-snapshot.ts` (NEW)
- `apps/worker/src/sequence/effects.ts` (extends — coordinate with UPSILON)
- `apps/worker/src/index.ts` (register 3 new handlers)
- `apps/web/src/lib/seed-inbox.functions.ts` (NEW)
- `apps/web/src/lib/deliverability.functions.ts` (NEW)
- `apps/web/src/lib/sequences.functions.ts` (extends `enrollProspects` — coordinate with TAU on adjacent sections)
- `apps/web/src/lib/effect-executor.ts` (extends for `emit_canary_bundle` kind)
- `apps/web/src/routes/_protected/settings/deliverability.tsx` (extends — UPSILON created; you add Seed Inboxes + Canary Config sections below)
- `apps/web/src/routes/_protected/deliverability/index.tsx` (NEW grid page)
- `apps/web/src/routes/_protected/deliverability/route.tsx` (NEW route configuration if needed)
- `apps/web/src/routes/_protected/sequences/$id/index.tsx` (live indicator section)
- `packages/config/src/env.schema.ts` (add `SYSTEM_SEED_ENCRYPTION_KEY` optional — Foundation + UPSILON didn't; you own this line)
- `scripts/seed-pool-bootstrap.ts` (NEW example — real config lives in OMEGA-OPS runbook)
- `internal-runbooks/seed-pool-config.example.json` (NEW example only)

## Do NOT touch

- `packages/db/src/schema/prospects.ts` — TAU
- `packages/db/src/schema/mail.ts` — UPSILON extended
- `packages/mail/src/gateway-detect.ts` — TAU real impl
- `packages/mail/src/content-sanitizer.ts` — UPSILON
- `apps/worker/src/sequence/mailbox-router.ts` — UPSILON
- `apps/worker/src/sequence/reserve-slot.ts` — UPSILON
- `apps/worker/src/handlers/gateway-detect.ts` — TAU
- `apps/web/src/lib/mailboxes.functions.ts` — UPSILON
- `apps/web/src/lib/prospects.functions.ts` — TAU
- `apps/web/src/routes/_protected/settings/mailboxes/**` — UPSILON
- `packages/core/src/state-machine/entry-conditions.ts` — TAU
- `packages/core/src/deliverability/mailbox-safety.ts` — Foundation shipped; import only

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
pnpm tsx scripts/load-test-engine.ts  # still passes
```

Extend load test with two new modes:
- `--test-mode=canary-happy-path`: 100 canaries across 5 seed inboxes, all arrive within 15 min, grid updates in <30s
- `--test-mode=canary-auto-pause`: simulate one seed's silent-drop (mock IMAP returns not_found on canary), verify sequence auto-pauses after 3 canaries

Manual smoke (limited without real seed pool):
- Create a seed inbox pointing to Mailpit's IMAP endpoint (docker-compose local)
- Inject a canary via a real sequence
- Verify grid updates within 15 min
- Simulate silent drop → verify auto-pause

## Result

```json
{
  "status": "ok",
  "track": "PHI",
  "phase_section": "11C",
  "tickets_completed": ["11C.1", ..., "11C.14"],
  "tickets_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "Full code path for canary system shipped. OMEGA-OPS runbook handles pool provisioning in parallel."
}
```
