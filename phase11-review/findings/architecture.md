# Architecture Review Findings

## Summary
- Files reviewed: ~95 (packages/mail, packages/core/deliverability, packages/db/schema, apps/web server-fns + routes, apps/worker handlers/sequence engine, 4 Phase 11 migrations)
- Critical: 0, High: 0, Medium: 1, Low: 5
- Overall: **needs-fixes**

Phase 11 preserves the monorepo layering established in Waves 5–6: `packages/mail` stays free of `@quiksend/integrations`, `packages/core/deliverability/*` is I/O-free, the `orgFn` tenancy chokepoint wraps all new server functions, and Wave 6's `applyWebEffects` path is used for enrollment control and manual-anchor capture. The main architectural debt is **spec-vs-implementation drift on canary effect kinds** — `send_canary` and `emit_canary_bundle` exist in the `Effect` union and worker executor but are never produced by `transition()`, while the real canary path uses enrollment-time `enqueue("canary.send")`.

---

## Findings

### [ARCH-001] Canary effect kinds in state machine are orphaned; real path bypasses `transition()`

- **Location**: `packages/core/src/state-machine/types.ts:74-79`, `packages/core/src/state-machine/transition.ts` (no `send_canary` / `emit_canary_bundle` emissions), `apps/worker/src/sequence/effects.ts:57-61`, `apps/web/src/lib/effect-executor.ts:206-207`, `apps/web/src/lib/canary-injection.ts:97-114`
- **Severity**: medium
- **Confidence**: high
- **What**: Phase 11 extended the `Effect` union with `send_canary` and `emit_canary_bundle`. The worker implements `handleSendCanary` and both executors have switch arms for `emit_canary_bundle` (no-op `break`). Neither kind is ever emitted by `transition()` — a repo-wide search shows no `kind: "send_canary"` or `kind: "emit_canary_bundle"` producers. Canary sends are instead created in `injectCanariesForEnrollment`, which inserts `canary_send` rows and enqueues `canary.send` jobs directly.
- **Impact**: Future contributors may assume canaries flow through the state machine (as the Phase 11 spec describes) and wire new logic to dead effect kinds. The worker maintains two parallel canary-send mechanisms (`handleSendCanary` vs `canary-send-handler.ts`), only one of which is reachable. This is not a runtime bug today but erodes the "transition is the single source of truth" invariant Wave 6 established.
- **Fix**: Pick one model and align code + spec. Either (a) remove `send_canary` / `emit_canary_bundle` from the `Effect` union and worker/web executors, documenting enrollment-time job enqueue as the canonical path; or (b) have `transition()` / tick emit these effects and route sends exclusively through `applyTransitionEffects`. Avoid keeping both.

---

### [ARCH-002] SEG gateway allowlist duplicated across four locations

- **Location**: `packages/mail/src/gateway-detect.ts:68-77`, `packages/core/src/deliverability/mailbox-safety.ts:41-50`, `packages/core/src/deliverability/canary-config.ts:43-52`, `apps/web/src/components/gateway-badge.tsx:72-81`
- **Severity**: low
- **Confidence**: high
- **What**: The same eight SEG gateway string literals are maintained independently in mail (a `Set`), core (two parallel exports: `SEG_GATEWAYS` and `SEG_GATEWAY_VALUES`), and the web UI component. `mailbox-safety.ts` and `canary-config.ts` within `packages/core` duplicate each other.
- **Impact**: Adding or renaming a SEG vendor requires coordinated edits in multiple files. A missed update would cause routing (`isSegGateway`) and canary eligibility (`SEG_GATEWAY_VALUES`) to disagree silently.
- **Fix**: Single canonical export in `packages/core/deliverability` (or re-export from `@quiksend/mail/gateway-detect`'s `SEG_GATEWAYS`). UI should import from core, not redefine. Collapse `SEG_GATEWAYS` / `SEG_GATEWAY_VALUES` to one name inside core.

---

### [ARCH-003] Dead exports: `newCanaryToken` and `sanitizeForSegAsync`

- **Location**: `apps/worker/src/deliverability/canary-send.ts:184-186`, `packages/mail/src/content-sanitizer.ts:82-102`, `packages/mail/src/index.ts:25`
- **Severity**: low
- **Confidence**: high
- **What**: `newCanaryToken()` is exported but never imported anywhere; `canary-injection.ts` uses `randomUUID()` directly. `sanitizeForSegAsync` is exported from `@quiksend/mail` but only `sanitizeForSeg` (sync) is called — in `apps/worker/src/sequence/effects.ts:361`.
- **Impact**: Dead surface area confuses readers and suggests async inlining is production-ready when it is not wired.
- **Fix**: Remove unused exports, or wire them (use `newCanaryToken` in injection; use async sanitizer where network inlining is desired).

---

### [ARCH-004] `getSequenceDeliverability` server function has no UI consumer

- **Location**: `apps/web/src/lib/deliverability.functions.ts:205-259`, `apps/web/src/routes/_protected/sequences/$id/index.tsx` (uses `getSequenceDeliverabilityRisk` only, not `getSequenceDeliverability`)
- **Severity**: low
- **Confidence**: high
- **What**: PHI track added `getSequenceDeliverability` (live canary stats, threshold, auto-pause flag) behind `orgFn`, but no route or component calls it. The sequence detail page shows TAU outlook (gateway mix chart) and UPSILON risk banner (`getSequenceDeliverabilityRisk`) — the PHI "live deliverability indicator" section is absent.
- **Impact**: Orphaned API surface; product intent from the three-track sequence page merge is only partially delivered. Not a layering violation, but incomplete integration of the architecture's read path.
- **Fix**: Wire `getSequenceDeliverability` into `sequences/$id/index.tsx` (or enrollments/analytics) with polling, or remove until needed.

---

### [ARCH-005] `gatewayClassification` table lacks Drizzle `relations()`

- **Location**: `packages/db/src/schema/deliverability.ts:29-45` (table defined), no `gatewayClassificationRelations` alongside `seedInboxRelations` / `canarySendRelations` at `packages/db/src/schema/deliverability.ts:150-190`
- **Severity**: low
- **Confidence**: medium
- **What**: TAU's `gateway_classification` table is correctly defined with indexes, but unlike the PHI tables in the same file it has no `relations()` block. The table is global (not org-scoped), so relations would be minimal, but the omission is inconsistent with sibling tables in `deliverability.ts`.
- **Impact**: No functional breakage today — queries use `db.query.gatewayClassification` without relational joins. Minor inconsistency for future relational queries.
- **Fix**: Add an empty or self-contained relations export for consistency, or split detection vs canary schema files if relations are intentionally omitted for global cache tables.

---

### [ARCH-006] Worker duplicates `extractDomain` instead of reusing mail export

- **Location**: `apps/worker/src/handlers/gateway-detect.ts:12-17`, `packages/mail/src/gateway-detect.ts:133-138` (exported at line 311)
- **Severity**: low
- **Confidence**: high
- **What**: `gateway-detect.ts` handler defines a local `extractDomain` identical to the one in `@quiksend/mail/gateway-detect`, which is already exported for reuse.
- **Impact**: Trivial drift risk if email parsing rules change in one place only.
- **Fix**: `import { extractDomain } from "@quiksend/mail/gateway-detect"` in the worker handler.

---

## Positive observations

- **CR-009 preserved**: `packages/mail/package.json` depends only on `@quiksend/config`, `nodemailer`, and `zod`. `createAdapterForMailbox` accepts an injected `NangoProxyClient` and never calls `getNango()`. `gateway-detect.ts` has no DB or integrations imports.
- **`packages/core` purity intact**: All `deliverability/*` modules are pure (no `@quiksend/db`, no I/O). `entry-conditions.ts`, `auto-pause.ts`, and `mailbox-safety.ts` are evaluators over in-memory data. Cross-package gateway types use `import type` from `@quiksend/mail/gateway-detect`.
- **Tenancy chokepoint**: Every Phase 11 server function in `seed-inbox.functions.ts`, `deliverability.functions.ts`, and extended `organization.functions.ts` / `mailboxes.functions.ts` / `prospects.functions.ts` / `sequences.functions.ts` composes `orgFn`. Write paths (`setWorkspaceDeliverabilityPolicy`, `setWorkspaceCanaryConfig`, `setMailboxEnterpriseSafe`, seed CRUD) gate on `requireAdmin` / `isAdminOrOwner`. Deliverability Pro reads are metadata-gated before exposing provider-managed seeds.
- **Wave 6 effect-executor fixes retained**: `sequences.functions.ts:939-946` applies `applyWebEffects` for pause/resume/stop. `compose.functions.ts` delegates anchor capture to `captureManualAnchorForEnrollment` → `applyWebEffects`. `execute-step.ts:38-62` routes suppression and reply through `transition()` rather than synthesizing effects inline (Wave 5 ARCH-001 resolved).
- **State machine extension clean**: `no_safe_mailbox` added once in `types.ts:67` and handled in `transition.ts:112-117` with a single `Event` union — no duplicate event type declarations.
- **Shared safety helper**: `isMailboxSafeForGateway` in `packages/core/deliverability/mailbox-safety.ts` is used by both UPSILON routing (`mailbox-router.ts`) and PHI auto-downgrade logic, preventing divergent safety rules.
- **Package boundaries respected**: `gateway-detect.ts` delegates DNS to `dns.ts`; fingerprints live in auditable `gateway-fingerprints.json`. `content-sanitizer.ts` is a MIME transform (sync path used in production). Worker handlers orchestrate: `gateway-detect.ts` calls `detectEmailGateway` from mail; `canary-check.ts` delegates IMAP to `deliverability/seed-imap.ts`.
- **Foundation → TAU handoff**: Foundation stubs in `gateway-detect.ts` were fully replaced with real MX → DMARC → SPF cascade detection — no `NotImplementedError` remains.
- **Data model**: `deliverability.ts` (~190 lines) consolidates TAU + PHI tables cleanly; `deliverability-enums.ts` holds shared pgEnums. All four migrations (0015–0018) are additive-only with sensible FK cascades (`enrollment` → `set null`, org-scoped tables → `cascade`). Drizzle `casing: "snake_case"` is honored (`enterpriseSafe` → `enterprise_safe`, `emailGateway` → `email_gateway`, `deliverabilityPct` → `deliverability_pct`).
- **UI route separation**: `_protected/deliverability/index.tsx` (operational grid) and `_protected/settings/deliverability.tsx` (policy + canary config) are distinct concerns. Sequence detail page deliverability sections (risk banner + gateway mix chart) are readable, not entangled.
- **Provider-managed seed model**: `seed_inbox.organization_id` nullable by design; user-seed queries always filter `eq(organizationId)`, provider pool reads are Pro-gated. `seedInbox` is in `APP_SCOPED_TABLES` with the tenancy guard recognizing files that reference `organizationId`.
