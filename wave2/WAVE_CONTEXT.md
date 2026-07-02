# WAVE_CONTEXT.md — Wave 2 (Phases 5 + Phase 4 remainder)

**Read this + `WAVE_CONTEXT.md` at the repo root before your brief.**

Wave 1 landed as three separate PRs (Phase 2, Phase 3-back, Phase 4-back). Wave 2
runs **two** parallel tracks now that the schemas + adapters + CRM connect flow are
in place.

## Wave 2 tracks

| Track       | Phase                                                                            | Depends on (Wave 1)                                                                        |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Track E** | Phase 5 — Sequence model + builder + enrollment                                  | Phase 2 (prospects, lists) + Phase 4 (mailboxes)                                           |
| **Track F** | Phase 4 remainder — Gmail + Microsoft Graph adapters + full SPF/DKIM/DMARC check | Phase 3 (Nango) + Phase 4 back-half (MailboxAdapter contract + smtp adapter for reference) |

Both tracks are still I/O-disjoint on files: Track E lives in
`packages/db/src/schema/sequences.ts` + `apps/web/src/routes/_protected/sequences/**`,
Track F lives in `packages/mail/src/adapters/{gmail,microsoft}.ts` + optional
`packages/mail/src/dns.ts` extensions.

## Ground rules (unchanged from Wave 1)

- Context7 MCP for every non-trivial package call. Zero training-data guesses.
- `orgFn` on every data-touching server fn.
- `pnpm check` green before RESULT.json status=ok. Zero tolerance.
- Explicit `.ts`/`.tsx` extensions, `import type` for types.
- Every new app-scoped table added to `APP_SCOPED_TABLES` in
  `packages/db/src/tenancy-guard.test.ts`.

## Cross-track coordination

### Shared `packages/core` extraction

Phase 5's builder needs the schedule-preview math. Foundations already exports
`computeSchedule` from `@quiksend/core/schedule`. Track E consumes it read-only —
do NOT modify. The engine (Phase 6, Wave 3) is the next place that touches it.

### `packages/mail` adapter registry

Track F adds two new adapter factories. Extend `packages/mail/src/adapters/index.ts`
barrel to include them. Track F does NOT touch the smtp adapter's public API.

### Enrollment table foreign keys

Track E's `enrollment` table references `sequence_id`, `prospect_id` (from Phase
2), `mailbox_id` (from Phase 4 back-half). Both those tables now exist on `main`,
so FKs can be direct.

### Bidirectional field for Phase 6

Per plan Appendix A, `enrollment` should carry `anchor_message_id`,
`anchor_thread_id`, `attempt_count`, `last_error`, `idempotency_key`, `next_run_at`
from day one so Phase 6 (Wave 3) doesn't have to migrate them. Track E creates
these NULLABLE — Phase 5 only reads/writes `next_run_at` and `mailbox_id`.

## Nango integration IDs

Track F's Gmail + Microsoft mailbox connects use Nango integration ids
`google-mail` (Gmail) + `microsoft` (Graph). These are the DEFAULTS Nango
provides; workspaces may override via Nango dashboard.
