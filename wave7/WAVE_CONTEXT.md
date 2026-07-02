# WAVE_CONTEXT.md - Wave 7 (Phase 11: Enterprise Deliverability)

**Read `CLAUDE.md` + `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` first.** Then read your track brief.

## What this is

Phase 11 ships enterprise deliverability. SEGs (Proofpoint / Mimecast / Barracuda /
Cisco) silently drop 25–45% of enterprise sends from consumer ESPs. Quiksend detects
these SEG-protected recipients, routes around them via enterprise-safe mailboxes when
possible, and canary-tests real-time deliverability to catch silent drops before a
whole campaign lands in a blackhole.

Full design in `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`.
The spec is authoritative — this file is coordination only.

## Wave 7 structure

Two sub-waves for coordination:

### Sub-wave 7.0 — Foundation (solo, ~30 min)
Ships the shared schema + type foundations that Wave 7.1 tracks all reference:
- `gateway_type` + `canary_arrival_status` + `seed_inbox_pool_tag` enums
- `prospect.email_gateway` + `gateway_classified_at` + `gateway_evidence` columns
- `mailbox.enterprise_safe` + related columns
- `packages/core/src/deliverability/mailbox-safety.ts` — shared helper type + stub
- `packages/mail/src/gateway-detect.ts` — types-only stub (throws NotImplementedError)
- Migration `0015_phase11_foundation.sql`

Merges to main first. Sub-wave 7.1 all rebase against it.

### Sub-wave 7.1 — Four parallel tracks

- **TAU** — Phase 11A Detection + Segmentation
- **UPSILON** — Phase 11B Routing
- **PHI** — Phase 11C Canary (code)
- **OMEGA-OPS** — Phase 11C Provider seed pool (ops runbook, docs-only)

## Non-negotiables

Same as prior waves:

- `pnpm install --frozen-lockfile` FIRST on the fresh worktree.
- **Context7 MCP for every library lookup.** Do not rely on training data.
- `pnpm check` MUST be **green** before RESULT.json status=ok. Zero lint, zero type, zero failing tests.
- Migration numbering: Foundation owns 0015. TAU 0016, UPSILON 0017, PHI 0018. Rebase-renumber if merge order shifts.
- Explicit `.ts`/`.tsx` extensions on relative imports; `import type` for type-only imports.
- Write `RESULT.json` at the worktree root when done.

## File-ownership map

Per Phase 11 spec + collision analysis. Enforced strictly.

| File | Owner | Others' interaction |
|---|---|---|
| `packages/db/src/schema/prospects.ts` | Foundation (initial), TAU (indexes for gateway) | None else |
| `packages/db/src/schema/mail.ts` | Foundation (initial), UPSILON (mailbox indexes/columns) | None else |
| `packages/db/src/schema/deliverability.ts` (NEW) | PHI | None else |
| `packages/mail/src/gateway-detect.ts` | Foundation (stub), TAU (real impl) | None else |
| `packages/mail/src/gateway-fingerprints.json` (NEW) | TAU | None else |
| `packages/mail/src/content-sanitizer.ts` (NEW) | UPSILON | None else |
| `packages/mail/src/mime.ts` | PHI (extends for canary token) | Small extension |
| `packages/core/src/deliverability/mailbox-safety.ts` (NEW) | Foundation (stub), UPSILON + PHI import | Foundation stub only |
| `packages/core/src/state-machine/entry-conditions.ts` | TAU | None else |
| `packages/core/src/state-machine/transition.ts` | UPSILON + PHI (adjacent event branches) | Merge-carefully |
| `apps/worker/src/handlers/gateway-detect.ts` (NEW) | TAU | None else |
| `apps/worker/src/handlers/canary-check.ts` (NEW) | PHI | None else |
| `apps/worker/src/sequence/mailbox-router.ts` (NEW) | UPSILON | PHI imports for auto-downgrade |
| `apps/worker/src/sequence/reserve-slot.ts` | UPSILON (extends for SEG throttle) | PHI reads unchanged |
| `apps/worker/src/sequence/effects.ts` | UPSILON (sanitizer call) + PHI (canary handling) | Adjacent hunks; coordinate via NEEDS.md if collision |
| `apps/web/src/lib/prospects.functions.ts` | TAU | None else |
| `apps/web/src/lib/mailboxes.functions.ts` | UPSILON | None else |
| `apps/web/src/lib/sequences.functions.ts` | TAU (step editor server-fns) + PHI (enrollment canary) | Different functions; no collision |
| `apps/web/src/lib/analytics.functions.ts` | TAU (gateway mix) | Adjacent |
| `apps/web/src/routes/_protected/settings/deliverability.tsx` (NEW) | UPSILON creates shell + routing section | PHI extends with canary section via INS.POST |
| `apps/web/src/routes/_protected/deliverability/index.tsx` (NEW) | PHI | None else |
| `apps/web/src/routes/_protected/sequences/$id/index.tsx` | TAU (outlook panel), UPSILON (warning banner), PHI (live indicator) | 3-way adjacent sections |
| `apps/web/src/routes/_protected/prospects/**` | TAU | None else |

## Result payload

Write `RESULT.json` at worktree root:

```json
{
  "status": "ok" | "partial" | "blocked",
  "track": "FOUNDATION" | "TAU" | "UPSILON" | "PHI" | "OMEGA-OPS",
  "phase_section": "11A" | "11B" | "11C" | "foundation",
  "tickets_completed": ["11A.1", "11A.2", ...],
  "tickets_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
