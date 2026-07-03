# TRACK SIGMA — Webhook Fanout + UI Wiring + Docs Alignment

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave8-sigma-webhook-ui` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave8/WAVE_CONTEXT.md`
3. `phase11-review/CONSOLIDATED.md`
4. `phase11-review/findings/completeness.md` § COMP-P11-001, 004, 005, 006, 007, 010, 011, 012, 013, 014
5. `phase11-review/findings/testing.md` § TEST-009, TEST-015, TEST-016
6. `phase11-review/findings/security.md` § SEC-P11-004, SEC-P11-006
7. `phase11-review/findings/correctness.md` § CORR-007
8. `phase11-review/findings/architecture.md` § ARCH-002, ARCH-004, ARCH-005
9. `apps/worker/src/handlers/webhook-fanout.ts`, `apps/worker/src/sequence/execute-effects.ts`
10. `apps/web/src/routes/_protected/sequences/$id/index.tsx`
11. `docs/webhooks.md`, `docs/deliverability.md`, `internal-runbooks/seed-pool-setup.md`

## Findings assigned (16 CRs)

### High (3)
- **CR-01** — Phase 11 webhook events registered but never emitted or fanned out
- **CR-08** — Deliverability + gateway tenancy tests absent (Wave 5 TEST-015 pattern)
- **CR-17** — In-app auto-pause notifications missing (11C.14 partial)

### Medium (7)
- **CR-16** — Sequence live canary indicator server-fn shipped but not wired to UI
- **CR-20** — `docs/deliverability.md` overstates classification triggers (CRM + API)
- **CR-26** — Runbook + troubleshooting docs claim PHI shipped provider-seed crons that don't exist
- **CR-28** — SEG gateway allowlist duplicated across 4 locations (docs side — the code dedup is PHI2)
- **CR-29** — Content sanitizer `preferPlainText` completeness heuristic (delegate to PHI2 who owns file; you own the doc note)
- **CR-31** — `listSeedInboxes` exposes provider-managed seed email addresses
- **CR-33** — `gatewayClassification` lacks Drizzle `relations()` (doc side — add note; PHI2 fixes code)

### Low (6)
- **CR-39** — "15 new test files" claim overstated
- **CR-40** — `TRACKING_PIXEL_DOMAIN` env var undocumented
- **CR-41** — Deliverability grid lacks global navigation
- **CR-42** — `docs/deliverability.md` webhook event names mismatch
- **CR-43** — Success metrics dashboard + spec feature flags (deferred honestly in docs)

## Documentation lookup (mandatory)
Context7 MCP for:
- **`insertDomainEventAndFanout`** / **`fanoutWebhookEvent`** — actual function signatures in `apps/worker/src/handlers/webhook-fanout.ts`
- **TanStack Router** — data-loading from server-fns in route loaders, `useLoaderData` refresh patterns
- **shadcn Alert** + **Sonner** — for auto-pause banner + toast
- **Better Auth** — role check patterns (`isAdminOrOwner`)

## Tasks

### T1 — Fix CR-01 (webhook fanout wiring — the single biggest fix)

**Sub-task 1a**: Align event type names between internal `event.type` and `SUPPORTED_WEBHOOK_EVENTS`:
- Currently: worker writes `event.type = 'canary.silent_drop_detected'` and `SUPPORTED_WEBHOOK_EVENTS` has `'deliverability.canary.silent_drop'` — mismatch
- Decide: use `deliverability.canary.silent_drop` everywhere (matches spec + docs)
- OMICRON's `canary-check.ts` refactor: they'll rename the event type via section-boundary comment; write to OMICRON's `NEEDS.md` for a specific line-region ownership

**Sub-task 1b**: Add fanout calls at each Phase 11 signal point:

- `apps/worker/src/handlers/canary-check.ts` `applyCanaryMatches` (OMICRON's file — coordinate):
  - When arrival matched → `await insertDomainEventAndFanout({ organizationId, eventType: 'deliverability.canary.arrived', payload: { canarySendId, seedInboxId, mailboxId, gateway, folder, arrivedAt } })`

- Same file, silent-drop sweep after 24h:
  - `await insertDomainEventAndFanout({ organizationId, eventType: 'deliverability.canary.silent_drop', payload: { canarySendId, seedInboxId, mailboxId, gateway, sentAt, expectedArrivalAt } })`

- `apps/worker/src/sequence/execute-effects.ts` `handleEmitEvent` for `enrollment.no_safe_mailbox_for_gateway`:
  - Currently persists to `event` table only. Add fanout: `await insertDomainEventAndFanout({ organizationId: enrollment.organizationId, eventType: 'enrollment.no_safe_mailbox_for_gateway', payload: { enrollmentId, mailboxId, recipientGateway, reason } })`

- `apps/worker/src/handlers/gateway-detect.ts` (RHO's file — coordinate):
  - After `applyClassificationToProspects` when gateway changed from previous value → for each affected prospect emit `gateway.detected`
  - Or per-domain: after cache write, if the gateway changed vs previous cached gateway → fanout to all orgs with prospects at that domain
  - Coordinate with RHO on WHERE to insert this call

**Coordination**: For OMICRON's canary-check.ts and RHO's gateway-detect.ts, write `NEEDS.md` with exact fanout call code + insertion point comments. Those tracks apply the calls; you verify.

Alternative if coordination is too fragile: SIGMA opens the PR after OMICRON + RHO merge, adds fanout as a follow-up.

**Sub-task 1c**: Reconcile `SUPPORTED_WEBHOOK_EVENTS` in `packages/db/src/schema/api.ts`:
- Verify all 4 Phase 11 events are present: `enrollment.no_safe_mailbox_for_gateway`, `deliverability.canary.arrived`, `deliverability.canary.silent_drop`, `gateway.detected`
- No renames needed if the docs catchup was correct

### T2 — Fix CR-08 (tenancy tests)

Create `apps/web/src/lib/deliverability-tenancy.test.ts` and `apps/web/src/lib/gateway-tenancy.test.ts`:

Follow the exact pattern from `apps/web/src/lib/prospect-tenancy.test.ts` (Wave 5 TEST-015 established this):

**`deliverability-tenancy.test.ts`**:
- Setup: `withTestOrgs` with 2 orgs A and B
- Seed org A with a seed_inbox, canary_send, deliverability_snapshot rows
- Attempt to read via `listSeedInboxes` / `getCanaryHistory` / `getDeliverabilityGrid` as org B → assert empty/404
- Attempt to mutate (delete seed inbox, toggle active) org A's rows as org B → assert error
- Assert provider-managed rows (organization_id=NULL) visible only to Pro-entitled workspaces

**`gateway-tenancy.test.ts`**:
- Setup: 2 orgs with prospects at overlapping domains
- Seed gateway_classification cache
- Assert cache visible to both orgs (intentional per design)
- Assert prospect-level `email_gateway` field org-scoped: org B cannot see org A's prospect gateway data

### T3 — Fix CR-16 (sequence live canary indicator UI wiring)

`apps/web/src/routes/_protected/sequences/$id/index.tsx`:
- Loader: `Promise.all` to include `getSequenceDeliverability` from `deliverability.functions.ts`
- Render a "Live deliverability" section below existing gateway mix chart:
  - Show percentage as colored badge (green ≥ 90%, yellow 50–90%, red < 50%)
  - Show sample size ("last 2h · X canaries")
  - If `autoPaused`, show a persistent Alert banner "Auto-paused: canary threshold breached"
  - Polling: refresh every 30s using TanStack Router loader with a manual refresh trigger (or `useInterval` client-side)

### T4 — Fix CR-17 (in-app auto-pause notifications)

`apps/web/src/routes/_protected/sequences/$id/index.tsx`:
- Detect first-visit-after-pause using a client-side query state (`autoPaused && !dismissed`)
- Show Sonner toast on first render with link to Deliverability grid
- Show persistent red Alert banner while paused
- Include "Resume sequence" button (calls existing sequence resume server-fn)

### T5 — Fix CR-20 (docs classification triggers accuracy) + CR-42 (webhook event names in docs)

`docs/deliverability.md`:
- CR-20: narrow classification triggers to "manual create + CSV import" (accurate) OR — better — coordinate with RHO to add CRM + API paths and keep the current doc. Preferred: RHO adds paths, you leave docs accurate.
- CR-42: fix webhook event name references — `enrollment.paused` for canary auto-pause is wrong; replace with `deliverability.canary.silent_drop` per CR-01 fix

### T6 — Fix CR-26 (runbook + troubleshooting reconciliation)

Given PHI2 will implement the seed pool crons (CR-09), your docs can accurately reference them. But wait for PHI2 to confirm the cron names — if PHI2 defers, rewrite the docs.

Preferred sequence:
1. PHI2 implements or explicitly defers CR-09
2. If implemented: reconcile docs to reference correct handler + cron cadence + alert channel
3. If deferred: rewrite `internal-runbooks/seed-pool-setup.md:451,470` + `docs/troubleshooting.md:413` to say "manual weekly ops procedure — no automation yet, on the roadmap for Wave 9"

### T7 — Fix CR-31 (hide provider seed addresses)

`apps/web/src/lib/seed-inbox.functions.ts` `listSeedInboxes`:
- For provider-managed rows (`organization_id IS NULL`): transform the response
  - Group by gateway
  - Show "Proofpoint pool (3 seeds)" instead of individual email addresses
  - Keep `providerManaged: true` flag for UI logic
  - Users can see COUNT but not IDENTIFIERS

Add a UI-friendly type:
```typescript
type SeedInboxListItem =
  | { kind: 'user'; id: string; email: string; ... }
  | { kind: 'provider_pool_summary'; gateway: EmailGateway; count: number; };
```

### T8 — Fix CR-40 (env var docs)

- `.env.example`: add `TRACKING_PIXEL_DOMAIN` under "Enterprise deliverability" section with comment
- `docs/self-host.md`: add row to the optional env vars table

### T9 — Fix CR-41 (deliverability grid nav link)

`apps/web/src/routes/_protected.tsx` (or wherever the nav is):
- Add a "Deliverability" nav link visible to all authenticated workspace members
- Link to `/_protected/deliverability` grid page
- Icon: any relevant one (shield, chart, etc.)

If Quiksend has no side-nav today (verify via grep), add a top-nav item next to the workspace switcher.

### T10 — Fix CR-28 (SEG gateway allowlist docs)

Add a comment in one of the 4 duplicate locations noting the canonical source, so future readers know where to update. The code dedup is PHI2's — you own the note.

### T11 — Fix CR-33 (gatewayClassification relations docs)

Add a comment in `packages/db/src/schema/deliverability.ts` noting why `gatewayClassification` has no `relations()` (intentional: shared cache, no org tie). PHI2 owns the code if adding an explicit empty relations block.

### T12 — Fix CR-39 (test count accuracy)

`phase11-review/CONTEXT.md` (or a follow-up note): update to reflect actual counts. Or leave it — it's a low-priority historical accuracy note. Consider whether to close as documented.

### T13 — Fix CR-43 (deferred metrics + feature flags — honesty check)

Add a section to `docs/deliverability.md` "Deferred to Phase 12" listing:
- Success metrics dashboard
- Per-workspace feature flags

Set expectations: not blockers for Phase 11 GA.

## Files owned (strict)

- `apps/worker/src/handlers/webhook-fanout.ts` (extend if needed)
- `apps/worker/src/sequence/execute-effects.ts` (add fanout to no_safe_mailbox)
- `packages/db/src/schema/api.ts` (verify + potential rename)
- `apps/web/src/lib/seed-inbox.functions.ts` — `listSeedInboxes` only (CR-31). PHI2 owns `createUserSeedInbox` (host validation). Both add narrow patches.
- `apps/web/src/lib/deliverability-tenancy.test.ts` (NEW)
- `apps/web/src/lib/gateway-tenancy.test.ts` (NEW)
- `apps/web/src/routes/_protected/sequences/$id/index.tsx` (CR-16, CR-17)
- `apps/web/src/routes/_protected/deliverability/index.tsx` (CR-41 polish)
- `apps/web/src/routes/_protected.tsx` (CR-41 nav)
- `docs/deliverability.md` (CR-20, CR-42, CR-43)
- `docs/webhooks.md` (verify event names)
- `docs/troubleshooting.md` (CR-26)
- `docs/self-host.md` (CR-40)
- `.env.example` (CR-40)
- `internal-runbooks/seed-pool-setup.md` (CR-26)
- `phase11-review/CONTEXT.md` (CR-39 accuracy update)

## Do NOT touch

- Canary internals (`canary-send.ts`, `canary-check.ts` main logic, `seed-imap.ts`, `canary-injection.ts`) — OMICRON
- Gateway detection handlers (`gateway-detect.ts` handler, `deliverability-snapshot.ts`) — RHO
- `packages/mail/src/gateway-detect.ts` — RHO (domain validation) + PHI2 (extractDomain)
- `packages/mail/src/dns.ts` — RHO
- `packages/mail/src/content-sanitizer.ts` — PHI2
- `packages/core/src/state-machine/*` — PHI2
- `packages/core/src/deliverability/*` — PHI2 (dedup + config)
- Provider seed pool handlers — PHI2
- `apps/worker/src/handlers/seed-pool-*.ts` (NEW) — PHI2
- `scripts/load-test-engine.ts` — PHI2
- `packages/queue/src/jobs.ts` — PHI2
- `apps/web/src/lib/canary-injection.ts` — OMICRON
- `packages/db/src/schema/deliverability.ts` — OMICRON (stepIndex) + RHO (indexes)

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
```

Manual smoke:
- Trigger a canary silent-drop → check that a webhook delivery is enqueued (via DB check on `webhook_delivery` table)
- Enroll prospects → sequence detail page shows live deliverability indicator
- Auto-pause a sequence → banner + toast appear on next visit
- List seed inboxes as Pro workspace → provider seeds show as summary count

## Result

```json
{
  "status": "ok",
  "track": "SIGMA",
  "findings_addressed": ["CR-01", "CR-08", "CR-16", "CR-17", "CR-20", "CR-26", "CR-28", "CR-31", "CR-33", "CR-39", "CR-40", "CR-41", "CR-42", "CR-43"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
