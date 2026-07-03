# COMPLETENESS REVIEW — Phase 11

## Task

Read-only comparison of Phase 11 spec's acceptance criteria against shipped code +
docs. Write findings to `phase11-review/findings/completeness.md` following the
format in `phase11-review/CONTEXT.md`.

## Focus areas

### P1 — ticket-by-ticket verification

Go through the 40 Phase 11 tickets (11A.1-11A.11, 11B.1-11B.10, 11C.1-11C.14, 11C.15-11C.19)
in `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`. For each,
verify the shipping PR did what the ticket said.

**Phase 11A (Detection + Segmentation) — TAU shipped**:

- **11A.1** Migration — verify `gateway_classification` table + `gateway_classification_confidence` enum + prospect column additions + `prospect_org_gateway_idx` present
- **11A.2** `gateway-detect.ts` real implementation — verify replaces Foundation stub, cascade implemented (MX → DMARC → SPF → unknown)
- **11A.3** Fingerprint externalization — verify `gateway-fingerprints.json` exists, loaded at module init
- **11A.4** 4 worker handlers registered — `gateway.detect_single`, `gateway.detect_bulk`, `gateway.apply_classification`, `gateway.sweep_stale`
- **11A.5** 5 server-fns — `classifyEmail`, `reclassifyDomain`, `getGatewayMixForOrg`, `getGatewayMixForList`, `getGatewayMixForSequence`
- **11A.6** Create/import wiring — `createProspect` and import worker enqueue detection
- **11A.7** Entry conditions extension — `recipientGatewayIn`, `recipientGatewayNotIn` in schema + evaluator
- **11A.8** UI: prospect badges + list filter + list detail chart
- **11A.9** UI: sequence step editor with new multi-selects
- **11A.10** UI: workspace overview card + sequence detail deliverability outlook
- **11A.11** Integration test for 200-prospect classification

**Phase 11B (Routing) — UPSILON shipped**:

- **11B.1** Migration — `send_reservation.recipient_domain` extension
- **11B.2** `mailbox-router.ts` with full decision table + anchor exception + auto-swap
- **11B.3** `content-sanitizer.ts` implementation
- **11B.4** Reserve-slot: SEG sub-cap + 5-min per-domain gap
- **11B.5** 4 server-fns: `setMailboxEnterpriseSafe`, workspace policy CRUD, `previewRoutingImpact`
- **11B.6** UI mailbox toggle + confirmation modal
- **11B.7** UI workspace deliverability settings page
- **11B.8** UI sequence warning banner + enrollment dialog warning
- **11B.9** State machine `no_safe_mailbox` event + paused nextState
- **11B.10** Integration test: 20 SEG-tagged prospects + 0 safe mailboxes + policy=enforce → all pause

**Phase 11C (Canary code) — PHI shipped**:

- **11C.1** Migration — `seed_inbox`, `canary_send`, `deliverability_snapshot` + `sequence.canary_config`
- **11C.2** Seed inbox CRUD server-fns + credential encryption
- **11C.3** `seed_inbox.verify` worker handler
- **11C.4** Canary injection in `enrollProspects`
- **11C.5** `buildMime` extended with `X-Quiksend-Canary-Id` header
- **11C.6** `effects.ts` canary handling
- **11C.7** IMAP polling worker `canary-check.ts` every 5min
- **11C.8** Auto-pause pure evaluator
- **11C.9** Deliverability snapshot refresh cron (15min)
- **11C.10** Server-fns: `getDeliverabilityGrid`, `getCanaryHistory`, canary config, Pro entitlement
- **11C.11** UI: seed inbox settings section
- **11C.12** UI: deliverability grid page (rows=mailboxes × cols=SEGs)
- **11C.13** UI: sequence detail live indicator
- **11C.14** Auto-pause notifications (in-app + email)

**Phase 11C-ops (Provider seed pool) — OMEGA-OPS shipped**:

- **11C.15** Runbook: domain acquisition + M365/GWS setup — `internal-runbooks/seed-pool-setup.md`
- **11C.16** Runbook: per-SEG subscription setup — verify covers Proofpoint / Mimecast / Barracuda / Cisco
- **11C.17** Provider seed bootstrap — `scripts/seed-pool-bootstrap.ts` + `SYSTEM_SEED_ENCRYPTION_KEY`
- **11C.18** Seed pool health check cron — is this ACTUALLY implemented in `apps/worker/src/handlers/*`? Or only in runbook?
- **11C.19** Legit-usage generator — same question: implemented or just documented?

### P1 — external documentation match

- **`docs/deliverability.md`** — every claim in this doc backed by shipped code? No forward-looking language for unshipped features?
- **`docs/webhooks.md`** Phase 11 events — do these events actually get fanned out? `SUPPORTED_WEBHOOK_EVENTS` was updated, but is the FANOUT wired in the worker for these events?
- **`docs/self-host.md`** env vars — do the docs list all actually-used vars?
- **`.env.example`** — Phase 11 vars documented?

### P2 — deferred items honesty

- Phase 11D was explicitly deferred. Verify no half-implementation of LinkedIn adapter leaked in
- My session note: canary load-test modes were declared but seedCanaryFixture removed. Verify the two `--test-mode=canary-*` modes DON'T claim to work in docs (if docs promise it, that's a completeness gap)

### P2 — README + user-facing surface

- README's Features list mentions "Enterprise deliverability — SEG detection... routing around consumer ESPs, real-time canary drop detection" — verify each of these is genuinely reachable via the shipped UI

### P2 — spec vs code drift

- Any places where the spec said "return X" but code returns Y?
- Any spec-mandated env vars missing from `packages/config/src/env.schema.ts`?
- The spec's Consolidated Migration Plan claimed 3 tables + 3 enums + column extensions. Actual migrations show `0015`, `0016`, `0017`, `0018` = 4 migrations. Verify the split is sensible (Foundation, TAU, UPSILON, PHI) and nothing's missing

### P3 — informational

- Phase 11 spec called out Six Open Questions at the end. Which have been resolved in the shipped code? Which remain?
- Success metrics (spec § Success Metrics) — is any instrumentation for these actually shipped?

## Do

- Read every `RESULT.json` in the Wave 7 worktrees if archived — but these are now deleted. Rely on the PR body summaries and code inspection.
- Read the Phase 11 spec end-to-end (long doc), then verify each Ticket section against the actual PR diff

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`
- Session summary I gave the user after v2.2.0: for context on what was claimed to ship
- Wave 5 completeness review (baseline): `review/findings/completeness.md`
