# WAVE_CONTEXT.md - Wave 8 (Phase 11 Fix Wave — Sprint 1 + Sprint 2 + Sprint 3)

**Read `CLAUDE.md` + `phase11-review/CONSOLIDATED.md` first.** Then read your track brief.

## What this is

Phase 11 shipped as v2.2.0 with strong architectural bones but 43 consolidated
findings ranging from **11 High** (webhook fanout not wired, canary signal quality,
provider seed pool crons missing) through **16 Medium** and **16 Low**. Wave 8
addresses ALL 43 findings across 4 parallel tracks — closes the review report
end-to-end.

Full review: `phase11-review/CONSOLIDATED.md`
Individual dimension findings: `phase11-review/findings/{security,correctness,architecture,performance,testing,completeness}.md`

## The 4 tracks

- **OMICRON** — Canary signal reliability + tests (CR-02/03/04/05/10/12/13/14/27/30) — 10 CRs, ~4 days
- **RHO** — Performance + gateway detection cache + DNS security (CR-06/07/15/18/23/24/25/34/35) — 9 CRs, ~3 days
- **SIGMA** — Webhook fanout + UI wiring + docs alignment (CR-01/08/16/17/20/21/26/28/29/31/33/39/40/41/42/43) — 16 CRs, ~4 days
- **PHI2** — Provider ops crons + testing gaps + arch cleanup (CR-09/11/19/22/32/36/37/38) — 8 CRs, ~3 days

Total: 43 CRs distributed. Zero overlap on ownership boundaries below.

## File ownership matrix

| Owner | Files (STRICT) |
|---|---|
| **OMICRON** | `apps/worker/src/deliverability/canary-send.ts`, `apps/worker/src/handlers/canary-check.ts` (except fanout calls — added by SIGMA), `apps/worker/src/deliverability/seed-imap.ts`, `apps/web/src/lib/canary-injection.ts`, `packages/db/src/schema/deliverability.ts` (adds `stepIndex` column via migration 0019 if needed) |
| **RHO** | `apps/worker/src/handlers/gateway-detect.ts`, `apps/worker/src/handlers/deliverability-snapshot.ts`, `packages/mail/src/dns.ts` (TXT timeout), `apps/web/src/lib/prospects.functions.ts` (`classifyEmail` admin gate + rate limit), NEW migration `0020_wave8_rho_perf_indexes.sql` |
| **SIGMA** | `apps/worker/src/sequence/execute-effects.ts` (add fanout to `no_safe_mailbox`), `packages/db/src/schema/api.ts` (event enum reconciliation), NEW `apps/worker/src/handlers/webhook-fanout.ts` helper extension, `apps/web/src/lib/seed-inbox.functions.ts` (hide provider addresses), `apps/web/src/routes/_protected/sequences/$id/index.tsx` (live indicator + auto-pause banner), `apps/web/src/routes/_protected.tsx` (deliverability nav link), `apps/web/src/routes/_protected/deliverability/index.tsx` (nav polish), all `docs/*.md` updates, `docs/self-host.md`, `.env.example`, `internal-runbooks/*.md` reconciliation, plus new tests `apps/web/src/lib/deliverability-tenancy.test.ts` + `apps/web/src/lib/gateway-tenancy.test.ts`, extend `SUPPORTED_WEBHOOK_EVENTS` if needed |
| **PHI2** | NEW `apps/worker/src/handlers/seed-pool-health.ts`, NEW `apps/worker/src/handlers/seed-pool-legit-mail.ts`, `scripts/load-test-engine.ts` (canary + gateway-detection modes), `packages/db/src/testing.ts` (add 3 tables to truncate list), `apps/web/src/lib/seed-inbox.functions.ts` (IMAP host allowlist for user seed — SIGMA also touches this file, coordinate via section boundary), `apps/worker/src/handlers/seed-inbox-verify.ts` (host validation), `packages/mail/src/gateway-detect.ts` (extractDomain export cleanup), `packages/core/src/deliverability/*` (SEG allowlist dedup + orphaned effect kinds removal), `packages/core/src/state-machine/transition.ts` + `types.ts` (remove `send_canary`/`emit_canary_bundle` per CR-27 Option A), `apps/worker/src/sequence/effects.ts` (remove `handleSendCanary`), `packages/mail/src/content-sanitizer.ts` (CR-29 completeness heuristic), `packages/queue/src/jobs.ts` (register new seed_pool jobs), 6 NEW test files for CR-21 |

## Coordination rules

**Overlap on `apps/web/src/lib/seed-inbox.functions.ts`**: PHI2 adds IMAP host allowlist to `createUserSeedInbox`; SIGMA changes `listSeedInboxes` to hide provider addresses. Different functions. Both add narrow patches; take both on merge.

**Overlap on `apps/worker/src/handlers/canary-check.ts`**: OMICRON does the big refactor; SIGMA adds 2 lines of `emitDeliverabilityEvent()` calls at specific hooks (arrival matched + silent drop swept). SIGMA writes a section boundary comment where its additions go and pushes only that hunk after OMICRON merges.

**Overlap on `packages/db/src/schema/deliverability.ts`**: OMICRON extends `canary_send` schema with `stepIndex` if migrating; RHO adds new indexes. Coordinate migration numbering: OMICRON owns 0019 (if it needs a migration), RHO owns 0020.

## Non-negotiables (same as prior waves)

- `pnpm install --frozen-lockfile` FIRST on the fresh worktree
- **Context7 MCP** for every non-trivial API call (Better Auth, Drizzle, pg-boss, imapflow, etc.)
- `pnpm check` MUST be **green** before RESULT.json status=ok
- **File-ownership boundaries in your brief are STRICT.** If a fix truly requires touching a file owned by another track, write `NEEDS.md` at the worktree root
- Migration numbering: OMICRON 0019 (if any), RHO 0020, PHI2 0021 (if any). Rebase-renumber at merge time
- Explicit `.ts`/`.tsx` extensions on relative imports; `import type` for type-only
- Write `RESULT.json` at the worktree root when done

## Result payload

```json
{
  "status": "ok" | "partial" | "blocked",
  "track": "OMICRON" | "RHO" | "SIGMA" | "PHI2",
  "findings_addressed": ["CR-02", "CR-03", ...],
  "findings_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
