# WAVE_CONTEXT.md — Wave 5 (V0 Review Fix Wave)

**Read `CLAUDE.md` + `review/CONSOLIDATED.md` first.** Then read your track brief.

## What this is

The full V0 multi-dimensional review (`review/CONSOLIDATED.md`) found 85 issues across
6 dimensions:
- **3 CRITICAL** — engine dead-letter unreachable, `next_run_at` cleared before success,
  suppression table not enforced pre-send
- **26 HIGH** — CAN-SPAM auto-send compliance, OAuth compose broken, security hardening
  gaps, architectural inversions, missing performance indexes, missing tests
- **35 MEDIUM** — perf indexes, security replay protection, refactorings
- **21 LOW** — style, informational

Wave 5 splits the fix work across **6 parallel agents** in isolated worktrees. Every
finding has an owning track. When all 6 merge, we ship **v2.1.0**.

## 6 tracks (parallel, disjoint file ownership)

| Track | Owner | Focus | Findings assigned |
|---|---|---|---|
| **ALPHA** | Engine + Compliance | Engine dead-letter reachable, next_run_at safety, suppression pre-check, real unsubscribe minter in auto-send, reservation atomicity, effect executor extraction | CR-001, CR-002, CR-003, CR-004, CR-005, CR-010, BUG-006, PERF-002, PERF-003 |
| **BETA** | OAuth mailboxes + PRD gap-close | OAuth compose enablement, inbox reply, testMailboxSend, prospect detail C3, sentiment tag, entry_condition worker enforcement, CRM-to-list UI | CR-006, COMP-002, COMP-004, COMP-005, COMP-006, COMP-007, COMP-008, COMP-011, COMP-013 |
| **GAMMA** | Security hardening + webhook replay | Auth IP rate limit wiring, prod-required env secrets, Nango replay protection, outbound HMAC includes deliveryId, DB-backed rate limit, compose sequence org filter, prompt injection wrapping, disconnectCrm org filter, remove unused WEBHOOK_SIGNING_SECRET | CR-007, CR-008, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-010, SEC-012 |
| **DELTA** | Architecture cleanup + correctness | Decouple packages/mail from integrations, AI provider metadata tuple, Graph delta pagination, prospect keyset cursor sort key, CSV import async job, enroll-with-anchor via computeSchedule, mail public exports tightened, _protected layout aligns with orgFn, extract shared Zod schemas, drop unused @quiksend/config in core | CR-009, CR-011, CR-012, CR-013, CR-014, ARCH-006, ARCH-008, ARCH-010, ARCH-011, ARCH-012, ARCH-013, ARCH-014, ARCH-015, ARCH-016 |
| **EPSILON** | Performance indexes + DB client | All missing indexes flagged by perf review: message.enrollment_id, cap `(mailbox_id, reserved_at)`, throttle partial, enrollment sequence_id, enrollment state, prospect default sort, pg_trgm on prospect fields, event(prospect_id), pgvector prefetch removal + org-scoped, postgres.js prepare:false comment | PERF-001, PERF-005, PERF-006, PERF-007, PERF-011, PERF-013, PERF-015, PERF-016, PERF-017, PERF-018, PERF-019, PERF-020, PERF-021, PERF-022, PERF-025, PERF-026, PERF-027, PERF-028, PERF-029 |
| **ZETA** | Testing coverage + tenancy expansion | 8 HIGH testing gaps (idempotency skip, captureManualAnchor DB, CRM writeback dedupe, HMAC webhook, API key scoping), tenancy tests for 9 missing entities, apikey to truncation list, tenancy guard APP_SCOPED_TABLES extension (jobLog, sendReservation, listMember, importError), load-test-in-CI, schema-parse retry test | All TEST-* findings, ARCH-007, ARCH-009 |

## Ground rules (all tracks)

- **Read-only until you have a plan.** Read the finding, the cited source, the existing
  tests, the phase brief. Then implement.
- **Context7 MCP for every non-trivial API** — Drizzle raw SQL, pg-boss v12 job metadata,
  Better Auth apiKey verify, Nango webhook payload shape, Microsoft Graph delta
  semantics, TanStack Start file routes, `ai` SDK provider adapters. Do not rely on
  training data.
- **`pnpm check` green** before RESULT.json status=ok. Zero lint errors, zero type
  errors, zero failing tests. If your change breaks an existing test, that's a signal
  the change is wrong or the test needs updating — either way, resolve it, don't
  suppress it.
- **Load test still passes.** After your changes, `pnpm tsx scripts/load-test-engine.ts`
  must still exit 0 with all invariants holding. If your change alters engine behavior,
  UPDATE the load test to cover the new failure modes you fixed.
- **File ownership boundaries are STRICT.** If a fix genuinely requires touching a file
  owned by another track, write `NEEDS.md` at the worktree root explaining what and
  why, and mark RESULT.json `status: "partial"` with notes.
- **Migration numbering**: tracks that add schema (BETA, GAMMA, EPSILON) each generate
  their own `pnpm db:generate --name wave5_<track>`. On merge order, drizzle-kit
  renumbers.
- **Conventional commits**: your PR will be titled `fix(<track>): <summary>`.
- **Explicit `.ts`/`.tsx` extensions** on relative imports. `import type` for type-only.

## Cross-track coordination

### Track ALPHA vs BETA on `effects.ts`
Track ALPHA owns `apps/worker/src/sequence/effects.ts` for CR-004 (real unsubscribe URL
minting in auto-send). Track BETA needs the same file for COMP-005 (entry_condition
enforcement). **Coordinate via `wave5/EFFECTS_HANDSHAKE.md`** — ALPHA writes its version
first, BETA rebases against ALPHA's changes when merging.

Actually simpler: ALPHA owns the file completely. BETA's `entry_condition` enforcement
goes in a new `packages/core/src/state-machine/entry-conditions.ts` module that ALPHA's
tick handler calls at the top of `handleTick`.

### All tracks that touch schema
BETA (may add `sentiment` col on `message`), GAMMA (adds `nango_webhook_processed`
table for replay), EPSILON (indexes on multiple tables). All three generate their
own migration; on merge, later PRs rebase and drizzle-kit renumbers.

### Load test extensions (ALPHA)
Track ALPHA extends `scripts/load-test-engine.ts` to cover the failure modes it fixes:
- Permanent send failure → enrollment reaches `failed` state
- Adapter success + outer TX rollback → no double-send on retry
- Manual suppression added mid-run → subsequent sends blocked

## Verification

Before RESULT.json status=ok:
```bash
pnpm install --frozen-lockfile
pnpm db:generate --name wave5_<track>   # only if you added schema
pnpm db:migrate
pnpm check                              # MUST be green
pnpm tsx scripts/load-test-engine.ts --workspaces=2 --enrollments=20 --workers=2 --duration=30  # for ALPHA + tracks touching engine
```

## RESULT.json shape

```json
{
  "status": "ok" | "partial" | "failed",
  "track": "ALPHA" | "BETA" | ...,
  "findings_addressed": ["CR-001", "CR-002", ...],
  "findings_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
