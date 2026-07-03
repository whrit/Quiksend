# Completeness Review Findings

## Summary

- Files reviewed: ~120 (Phase 11 spec, 4 migrations, gateway/canary/routing worker + web modules, deliverability docs, runbooks, load-test script, env schema)
- Critical: 0, High: 3, Medium: 6, Low: 5
- Overall: **needs-fixes**

Phase 11A (detection), 11B (routing), and most of 11C (canary code + UI) are **substantially shipped** — schema, worker handlers, server-fns, and primary UI routes all exist. The largest completeness gaps are: (1) **Phase 11 webhook events are registered in `SUPPORTED_WEBHOOK_EVENTS` and documented but never emitted/fanned out**; (2) **11C.18/11C.19 provider-seed crons are documented as shipped but have no worker implementation**; (3) **11C.13/11C.14 UI polish** (live canary indicator, in-app auto-pause alerts) has backend support but is not wired to the sequence detail page.

**Ticket scorecard:** 11A 11/11 ✅ · 11B 10/10 ✅ · 11C code 12/14 (11C.13–14 partial) · 11C-ops 3/5 (11C.18–19 missing code)

---

## Phase 11 ticket verification

| Ticket | Status | Evidence |
| ------ | ------ | -------- |
| **11A.1** Migration | ✅ | `0015_phase11_foundation.sql:8-11` prospect cols + `prospect_org_gateway_idx`; `0016_phase11a_gateway_classification.sql:1-14` table + `gateway_classification_confidence` enum |
| **11A.2** `gateway-detect.ts` | ✅ | `packages/mail/src/gateway-detect.ts:222-297` MX → DMARC → SPF → unknown cascade |
| **11A.3** Fingerprints JSON | ✅ | `packages/mail/src/gateway-fingerprints.json`; loaded at `gateway-detect.ts:120-131` |
| **11A.4** 4 worker handlers | ✅ | `apps/worker/src/handlers/gateway-detect.ts:105-231`; cron at `:229-231` |
| **11A.5** 5 server-fns | ✅ | `apps/web/src/lib/prospects.functions.ts:1100-1175` |
| **11A.6** Create/import wiring | ✅ | `prospects.functions.ts:421`; `import-prospects.ts:256` |
| **11A.7** Entry conditions | ✅ | `entry-conditions.ts:23-60`; sequence editor `edit.tsx:699-708` |
| **11A.8** Prospect badges + filter + chart | ✅ | `gateway-badge.tsx`; `prospects/index.tsx:194-504` |
| **11A.9** Sequence step editor multi-selects | ✅ | `sequences/$id/edit.tsx:136-708` |
| **11A.10** Dashboard card + sequence outlook | ✅ | `dashboard.tsx:53-78`; `sequences/$id/index.tsx:99-120` |
| **11A.11** 200-prospect integration test | ✅ | `gateway-detect.test.ts:99-132` |
| **11B.1** `recipient_domain` migration | ✅ | `0017_phase11b_routing.sql:1-2`; `enterprise_safe` cols sensibly in `0015` foundation |
| **11B.2** `mailbox-router.ts` | ✅ | Full decision table `mailbox-router.ts:75-122` + tests |
| **11B.3** `content-sanitizer.ts` | ✅ | `packages/mail/src/content-sanitizer.ts` + `content-sanitizer.test.ts` |
| **11B.4** SEG sub-cap + 5-min gap | ✅ | `reserve-slot.ts` + `reserve-slot.test.ts:40` |
| **11B.5** 4 server-fns | ✅ | `mailboxes.functions.ts:501`; `organization.functions.ts:38-147` |
| **11B.6** Mailbox toggle + modal | ✅ | `settings/mailboxes/index.tsx:71-313` |
| **11B.7** Deliverability settings page | ✅ | `settings/deliverability.tsx:317-327` |
| **11B.8** Sequence banner + enroll warning | ✅ | `sequences/$id/index.tsx:72-97`; `enroll.tsx:211-220` |
| **11B.9** `no_safe_mailbox` state machine | ✅ | `transition.ts:112-116`; `effects.ts:276` |
| **11B.10** SEG routing integration test | ✅ | `seg-routing.integration.test.ts:34-153` (20 prospects, enforce, 0 safe) |
| **11C.1** Canary migration | ✅ | `0018_phase11c_canary.sql` — 3 tables + `sequence.canary_config` |
| **11C.2** Seed inbox CRUD + encryption | ✅ | `seed-inbox.functions.ts` |
| **11C.3** `seed_inbox.verify` handler | ✅ | `handlers/seed-inbox-verify.ts:11-29` |
| **11C.4** Canary injection on enroll | ✅ | `canary-injection.ts`; hooked from `sequences.functions.ts:17` |
| **11C.5** `X-Quiksend-Canary-Id` header | ✅ | `mime.ts:68`; `mime.test.ts:70-80` |
| **11C.6** `effects.ts` canary handling | ✅ | `effects.ts:483-486` (`handleSendCanary`) |
| **11C.7** `canary-check.ts` 5-min cron | ✅ | `canary-check.ts:20-27` |
| **11C.8** Auto-pause pure evaluator | ✅ | `auto-pause.ts` + `auto-pause.test.ts` |
| **11C.9** Snapshot refresh 15-min cron | ✅ | `deliverability-snapshot.ts:8-10` |
| **11C.10** Grid/history/config server-fns | ✅ | `deliverability.functions.ts:41-259` |
| **11C.11** Seed inbox settings UI | ✅ | `settings/deliverability.tsx` `SeedInboxesSection` |
| **11C.12** Deliverability grid page | ✅ | `deliverability/index.tsx` |
| **11C.13** Sequence live indicator | ⚠️ Partial | Server-fn `getSequenceDeliverability` at `deliverability.functions.ts:205-258` exists; **not called** from `sequences/$id/index.tsx` |
| **11C.14** Auto-pause notifications | ⚠️ Partial | Email at `canary-check.ts:242-306`; **no in-app toast/banner** on sequence page |
| **11C.15** Domain acquisition runbook | ✅ | `internal-runbooks/seed-pool-setup.md` |
| **11C.16** Per-SEG subscription runbook | ✅ | `seed-pool-setup.md:230-384` (Proofpoint, Mimecast, Barracuda, Cisco) |
| **11C.17** Provider seed bootstrap | ✅ | `scripts/seed-pool-bootstrap.ts`; `SYSTEM_SEED_ENCRYPTION_KEY` in `env.schema.ts:55` |
| **11C.18** Seed pool health check cron | ❌ | Documented only — no handler in `apps/worker/src/handlers/*` |
| **11C.19** Legit-usage generator cron | ❌ | Documented only — no handler in `apps/worker/src/handlers/*` |

**Migration split (spec vs shipped):** Spec consolidated plan implied one migration; actual split across `0015` (foundation enums + col extensions), `0016` (gateway cache), `0017` (routing), `0018` (canary) is sensible and complete — nothing missing.

---

## Findings

### [COMP-P11-001] Phase 11 webhook events registered and documented but never emitted or fanned out

- **Location**: `packages/db/src/schema/api.ts:26-29`; `apps/worker/src/handlers/webhook-fanout.ts:12-48`; `apps/worker/src/sequence/execute-effects.ts:155-191`; `docs/webhooks.md:16-19`; `docs/deliverability.md:227-233`
- **Severity**: high
- **Confidence**: high
- **What**: Four Phase 11 event types (`enrollment.no_safe_mailbox_for_gateway`, `deliverability.canary.arrived`, `deliverability.canary.silent_drop`, `gateway.detected`) are in `SUPPORTED_WEBHOOK_EVENTS` and documented as subscribable. A repo-wide search shows **zero** `insertDomainEventAndFanout` / `fanoutWebhookEvent` calls from the worker. `handleEmitEvent` persists `enrollment.no_safe_mailbox_for_gateway` to `event` but returns without fanout (`execute-effects.ts:169-185`). Canary paths insert `canary.silent_drop_detected` (`canary-check.ts:230-236`) — a type **not** in `SUPPORTED_WEBHOOK_EVENTS`. `gateway.detected` and `deliverability.canary.arrived` are never inserted anywhere.
- **Impact**: External integrations subscribing to Phase 11 webhook events receive nothing. Docs and OpenAPI advertise capabilities that do not exist in production.
- **Fix**: On each Phase 11 signal, call `insertDomainEventAndFanout` with the documented event type and a tenant-scoped payload. Align internal event types with `SUPPORTED_WEBHOOK_EVENTS` (rename or alias `canary.silent_drop_detected` → `deliverability.canary.silent_drop`). Emit `gateway.detected` from `gateway-detect.ts` when classification changes a prospect row. Emit `deliverability.canary.arrived` from `applyCanaryMatches` in `canary-check.ts:99-118`.

---

### [COMP-P11-002] 11C.18 seed pool health check cron not implemented

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1440`; `internal-runbooks/seed-pool-setup.md:451-453`; `apps/worker/src/index.ts:43-83`
- **Severity**: high
- **Confidence**: high
- **What**: Ticket 11C.18 requires cron `seed_pool.health_check` (IMAP connectivity + dormancy checks). The worker boots 15+ handlers but registers no `seed_pool.*` jobs. The runbook states "Track PHI ships" for this cron, but no code exists.
- **Impact**: Provider-managed seed pool has no automated health monitoring; operational runbook steps assume automation that is not present.
- **Fix**: Add `apps/worker/src/handlers/seed-pool-health.ts` registering `seed_pool.health_check` on a 24h schedule; verify IMAP per active system seed; alert via logger/event row. Update runbook language if intentionally deferred.

---

### [COMP-P11-003] 11C.19 legit-usage generator cron not implemented

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1442`; `internal-runbooks/seed-pool-setup.md:468-471`; `internal-runbooks/seed-pool-legit-usage-patterns.md:1-3`
- **Severity**: high
- **Confidence**: high
- **What**: Ticket 11C.19 requires weekly cron `seed_pool.generate_legit_mail` using templates from the legit-usage patterns doc. No worker handler, queue job type, or schedule exists.
- **Impact**: Seed inboxes cannot maintain organic traffic automatically; SEG reputation risk for the provider pool remains a manual ops burden despite ticket closure claim.
- **Fix**: Implement handler + job registry entry; cap at 5 messages/seed/week per runbook; or explicitly defer ticket and remove "Track PHI ships" claims from runbooks.

---

### [COMP-P11-004] 11C.13 sequence live canary indicator — server-fn shipped, UI not wired

- **Location**: `apps/web/src/lib/deliverability.functions.ts:205-258`; `apps/web/src/routes/_protected/sequences/$id/index.tsx:13-136`
- **Severity**: medium
- **Confidence**: high
- **What**: `getSequenceDeliverability` returns rolling 2-hour deliverability %, sample size, threshold, `belowThreshold`, and `autoPaused`. The sequence detail page loads gateway mix and routing risk but never calls this fn — no live % indicator or auto-pause badge per spec § "Sequence detail live indicator".
- **Impact**: Users cannot see real-time canary health on the sequence they are monitoring without navigating to `/deliverability/`.
- **Fix**: Loader-fetch `getSequenceDeliverability` in `sequences/$id/index.tsx`; render indicator in the "Deliverability outlook" card (green/yellow/red + auto-paused banner when `autoPaused`).

---

### [COMP-P11-005] 11C.14 in-app auto-pause notifications missing

- **Location**: `docs/deliverability.md:209-217`; `apps/worker/src/handlers/canary-check.ts:242-306`; `apps/web/src/routes/_protected/sequences/$id/index.tsx`
- **Severity**: medium
- **Confidence**: high
- **What**: Docs promise "toast + persistent banner on the sequence page" when canary auto-pause fires. Worker sends admin email via SMTP (`canary-check.ts:275-305`) and inserts `canary.silent_drop_detected` event. No web UI reads that event or shows a banner/toast; grep for `auto-paused` / `autoPaused` in `apps/web/src/routes` returns only the unused server-fn field.
- **Impact**: Workspace members who are not email recipients learn about auto-pause only by noticing paused enrollments.
- **Fix**: Sequence detail loader checks paused state + recent `canary.silent_drop_detected` event; show persistent `Alert` and optional `sonner` toast on first visit after pause.

---

### [COMP-P11-006] `docs/deliverability.md` overstates classification triggers (CRM sync + public API)

- **Location**: `docs/deliverability.md:29-32`; `apps/worker/src/handlers/import-prospects.ts:256`; `apps/web/src/routes/api/v1/prospects.ts:157`
- **Severity**: medium
- **Confidence**: high
- **What**: Doc claims classification runs when a prospect is created via "manual, CSV import, **CRM sync, public API**". Only `createProspect` (`prospects.functions.ts:421`) and import worker enqueue `gateway.detect_*`. CRM sync handler has no gateway enqueue; public API `POST /api/v1/prospects` inserts directly without detection job.
- **Impact**: CRM-synced and API-created prospects stay `email_gateway = null` until background sweep or manual reclassify — undermining detection UX promises.
- **Fix**: Enqueue `gateway.detect_single` from CRM upsert path and API prospect create; or narrow doc to "manual create + CSV import".

---

### [COMP-P11-007] Runbooks falsely claim PHI shipped provider-seed crons

- **Location**: `internal-runbooks/seed-pool-setup.md:453`; `internal-runbooks/seed-pool-setup.md:470`; `docs/troubleshooting.md:413`
- **Severity**: medium
- **Confidence**: high
- **What**: Runbook and troubleshooting doc reference automated `seed_pool.health_check` and `seed_pool.generate_legit_mail` as shipped by PHI. No such jobs exist (see COMP-P11-002/003). Troubleshooting tells users "the seed pool health check cron should have alerted us".
- **Impact**: Ops runbooks describe automation that does not run; incident response assumptions are wrong.
- **Fix**: Either implement crons or rewrite runbook/troubleshooting to describe manual procedures and remove "Track PHI ships" language.

---

### [COMP-P11-008] Canary load-test modes declared but not implemented

- **Location**: `scripts/load-test-engine.ts:53-54`; `scripts/load-test-engine.ts:918-934`; `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1565`
- **Severity**: medium
- **Confidence**: high
- **What**: `--test-mode=canary-happy-path` and `--test-mode=canary-auto-pause` are in the `TestMode` union and adjust args (`load-test-engine.ts:95-100`), but the final `switch` only handles `permanent-failure`, `outer-rollback`, `suppression-during-run`, and `default` (happy-path). Canary modes fall through to `assertHappyPathInvariants()`. `seedCanaryFixture` was removed (no references remain).
- **Impact**: Spec exit CI extensions for 11C are not runnable; false sense of canary regression coverage.
- **Fix**: Implement canary fixture seeding + assertions in dedicated cases, or remove modes from the union and spec § Consolidated load-test list. **Do not** document them as working until implemented.

---

### [COMP-P11-009] `gateway-detection` load-test mode spec-only

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:604`; `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1563`; `scripts/load-test-engine.ts:52-54`
- **Severity**: low
- **Confidence**: high
- **What**: Spec calls for `--test-mode=gateway-detection` CI extension for 11A. Not present in `TestMode` union or load-test script. Coverage exists via `gateway-detect.test.ts` unit/integration test instead.
- **Impact**: Minor — spec/CI drift only; core 11A.11 test covers the invariant.
- **Fix**: Add mode or strike from spec consolidated list.

---

### [COMP-P11-010] Success metrics dashboard not shipped

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1590-1609`; `apps/web/src/routes/_protected/analytics/index.tsx`
- **Severity**: low
- **Confidence**: high
- **What**: Spec § Success Metrics calls for `_protected/analytics/deliverability.tsx` with six adoption/save metrics instrumented from `event` inserts. No such route exists; analytics index has no deliverability section.
- **Impact**: Product cannot track 11A–11C adoption KPIs from the app. Some raw signals exist in `event` table but no aggregation UI.
- **Fix**: Add analytics deliverability page or defer metrics to a fast-follow and note in spec.

---

### [COMP-P11-011] Spec feature flags not implemented

- **Location**: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1580-1586`
- **Severity**: low
- **Confidence**: high
- **What**: Spec lists `feature.gateway_detection`, `feature.seg_routing_policy`, `feature.canary_deliverability`, `feature.deliverability_pro` workspace flags. No gating code references these strings; features are always available (Pro tier uses `entitlements.deliverability_pro` only).
- **Impact**: Ops cannot disable a Phase 11 feature per-workspace without code change.
- **Fix**: Implement flag checks or remove from spec as deferred ops tooling.

---

### [COMP-P11-012] `TRACKING_PIXEL_DOMAIN` used by sanitizer but undocumented in env files

- **Location**: `packages/mail/src/content-sanitizer.ts:20`; `packages/config/src/env.schema.ts:64`; `.env.example`; `docs/self-host.md:36-47`
- **Severity**: low
- **Confidence**: high
- **What**: Content sanitizer reads `env.TRACKING_PIXEL_DOMAIN` to strip tracking pixels. Variable is in schema but absent from `.env.example` and `docs/self-host.md`. Falls back to `BETTER_AUTH_URL` host when unset.
- **Impact**: Self-hosters with custom tracking domains may not strip pixels correctly without discovering the var from source.
- **Fix**: Document in `.env.example` and `self-host.md` optional table.

---

### [COMP-P11-013] Deliverability grid lacks global navigation (weak discoverability)

- **Location**: `apps/web/src/routes/_protected.tsx:23-47`; `apps/web/src/routes/_protected/deliverability/index.tsx:28-72`; `README.md:73`
- **Severity**: low
- **Confidence**: medium
- **What**: `/deliverability/` route and grid UI exist and work, but the protected layout has no nav links — only header + workspace switcher. Users reach deliverability via deep links from sequence/settings pages or by typing the URL.
- **Impact**: README claim that enterprise deliverability is "reachable via the shipped UI" is technically true but discoverability is poor for the grid (core 11C surface).
- **Fix**: Add nav entry or dashboard link to Deliverability grid; link from deliverability settings page.

---

### [COMP-P11-014] `enrollment.paused` webhook doc for canary auto-pause does not match event type

- **Location**: `docs/deliverability.md:230`; `apps/worker/src/handlers/canary-check.ts:206-236`
- **Severity**: low
- **Confidence**: high
- **What**: Deliverability webhook table says subscribe to `enrollment.paused` for canary auto-pauses. Canary auto-pause updates enrollments to `paused` state directly (`canary-check.ts:206-215`) but inserts event type `canary.silent_drop_detected`, not `enrollment.paused` and not a webhook-fanned event.
- **Impact**: Webhook subscribers filtering on `enrollment.paused` miss canary-driven pauses.
- **Fix**: Emit documented event type with reason payload, or correct docs to `canary.silent_drop_detected` / `deliverability.canary.silent_drop` once fanout exists.

---

## Deferred / honesty checks (P2)

| Item | Status |
| ---- | ------ |
| **Phase 11D LinkedIn adapter** | ✅ Clean — no send adapter leaked; only pre-existing `linkedin_url` CRM/prospect fields |
| **Canary `--test-mode=canary-*` in user-facing docs** | ✅ `docs/deliverability.md` does not promise these modes; gap is spec + script union only (COMP-P11-008) |
| **11B.1 `enterprise_safe` in 11B migration** | ✅ Acceptable — cols in `0015` foundation; `0017` adds routing-specific `recipient_domain` |

---

## Open questions (spec § Open Questions) — resolution status

| # | Question | Resolved in shipped code? |
| - | -------- | ------------------------- |
| 1 | DoH fallback for MX | **Deferred** — not implemented; matches recommendation |
| 2 | Sequence-level canary threshold in UI | **Partial** — workspace + sequence `canary_config` in DB; sequence-level UI override not exposed (admin-only per recommendation) |
| 3 | Grid transport: poll vs SSE | **Resolved** — 30s polling in `deliverability/index.tsx` |
| 4 | Which SEGs to add to provider pool | **Open** — runbook TBD domains; post-launch decision |
| 5 | Sanitizer opt-out granularity | **Resolved** — workspace-level via `setWorkspaceDeliverabilityPolicy` |
| 6 | Auto-pause resume behavior | **Resolved** — stays paused; manual resume (docs + code align) |

---

## Positive observations

- **Detection cascade is real and testable** — `gateway-detect.ts` implements the full MX → DMARC → SPF pipeline with externalized fingerprints; 200×20 domain integration test passes (`gateway-detect.test.ts:99-132`).
- **Routing stack is end-to-end** — `mailbox-router.ts`, content sanitizer, SEG throttle in `reserve-slot.ts`, enforce-policy integration test with 20 Proofpoint prospects (`seg-routing.integration.test.ts`).
- **Canary pipeline is wired** — injection on enroll, `canary.send` handler, IMAP polling cron, auto-pause evaluator, snapshot rollup, grid UI, and seed inbox CRUD form a coherent vertical slice.
- **Migration layering is clean** — Foundation → TAU → UPSILON → PHI split (`0015`–`0018`) matches wave ownership and keeps rollbacks isolated.
- **User-facing guide quality** — `docs/deliverability.md` is thorough and mostly accurate; primary gaps are webhook fanout and CRM/API detection triggers, not core mechanics.
- **11C-ops runbook depth** — `internal-runbooks/seed-pool-setup.md` covers all four major SEGs with vendor-specific MX/DMARC steps; bootstrap script + example config ship as specified.
- **Tenancy patterns preserved** — new server-fns use `orgFn`; seed inbox and canary tables include `organization_id` FKs.
- **No Phase 11D leakage** — LinkedIn deferred per spec; no half-built channel adapter in the tree.
