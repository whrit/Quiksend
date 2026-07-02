# Architecture Review Findings

## Summary

- Files reviewed: ~120 (9 packages, 2 apps, schema/migrations, worker sequence engine, web server-fns, API v1 routes)
- Critical: 0, High: 5, Medium: 6, Low: 5
- Overall: **needs-fixes**

The layering described in `CLAUDE.md` and the phase plan is mostly respected: `packages/core` is I/O-free, package dependency direction is sane, migrations are healthy, and the worker effect executor covers all nine `Effect` kinds. The main architectural debt is **state-machine boundary erosion** — the web app and worker both interpret transitions outside the single executor path — plus a few package-boundary drifts (`packages/mail` → `packages/integrations`, AI metadata bypass).

---

## Findings

### [ARCH-001] Worker bypasses `transition()` for suppression and reply pre-checks

- Location: `apps/worker/src/sequence/execute-step.ts:27-56`
- Severity: **high** (architectural violation)
- What: Before calling `transition(snapshot, { kind: "tick", … })`, the worker synthesizes terminate effects directly when `isSuppressed(ctx)` or `hasReplyOnThread(ctx)`:

```typescript
await applyTransitionEffects(
  tx,
  ctx,
  [{ kind: "terminate", reason: "stopped" }],
  attempt,
  "stopped",
);
// …
await applyTransitionEffects(
  tx,
  ctx,
  [
    { kind: "terminate", reason: "replied" },
    { kind: "emit_event", type: "enrollment.replied" },
  ],
  attempt,
  "replied",
);
```

- Impact: Transition rules for `reply_received` / stop-on-suppression live in two places. If `packages/core/src/state-machine/transition.ts` changes (e.g., soft-stop vs hard-stop, event ordering), the worker pre-checks can drift silently.
- Fix: Emit proper `Event` values (`reply_received`, a dedicated suppression event, or route through guards that feed into `transition()`) so all state decisions remain in `transition.ts`.
- Confidence: high

---

### [ARCH-002] Web compose re-implements partial effect interpretation

- Location: `apps/web/src/lib/compose.functions.ts:338-399`
- Severity: **high** (architectural violation)
- What: After `transition(…, { kind: "manual_sent", … })`, compose manually loops effects and only handles `capture_anchor` and `advance_step`, then writes enrollment fields itself. It does not handle `schedule_at`, `emit_event`, or other kinds the state machine may emit.
- Impact: Manual-send path diverges from the worker executor (`apps/worker/src/sequence/effects.ts`). Any new effect on `manual_sent` will be dropped in the UI compose flow.
- Fix: Extract a shared effect applier (or enqueue a worker job) so web and worker share one interpreter. At minimum, delegate to the same switch the worker uses.
- Confidence: high

---

### [ARCH-003] Web pause/resume/stop applies `nextState` but drops `effects[]`

- Location: `apps/web/src/lib/sequences.functions.ts:836-865`
- Severity: **high** (architectural violation)
- What: `transitionEnrollment()` calls `transition(snapshot, event)` but only persists `result.nextState`. Returned `result.effects` (e.g. `{ kind: "emit_event", type: "enrollment.paused" }` from `packages/core/src/state-machine/transition.ts:23-24`) are never executed.
- Impact: Product/analytics events and downstream side effects from pause/resume/stop are silently missing when triggered from the web UI. Worker and web behavior diverge for the same events.
- Fix: Run effects through the shared executor (at least `emit_event`) or enqueue worker jobs for enrollment control mutations.
- Confidence: high

---

### [ARCH-004] `packages/mail` depends on `packages/integrations` (claimed: config-only)

- Location: `packages/mail/package.json:22-24`, `packages/mail/src/adapters/index.ts:2-7`
- Severity: **high** (architectural violation)
- What: Mail adapters import `getNango()` from `@quiksend/integrations` inside `createAdapterForMailbox`. Assignment and foundations layering claim mail depends on config only; CLAUDE.md states integrations is the Nango wrapper and the rest of the app should not import `@nangohq/node` directly — but mail now depends on the whole integrations package.
- Impact: Mail cannot be tested or reused without the CRM integration stack. Violates the “adapters are self-contained files” mental model.
- Fix: Inject a narrow `NangoProxyClient` at the app/worker boundary (worker already has `createMailboxAdapter`) so `packages/mail` stays config-only and accepts clients via factory config — matching how `createGmailAdapter` already supports injection.
- Confidence: high

---

### [ARCH-005] AI generation metadata bypasses model provider abstraction

- Location: `packages/ai/src/generation/generate-email.ts:13-16`
- Severity: **high** (architectural violation)
- What: `modelId()` reads `process.env.AI_DEFAULT_PROVIDER` directly and hard-codes model strings, while actual inference uses `getDefaultModel()` from `packages/ai/src/model/provider.ts:45-52`.

```typescript
function modelId(): string {
  const provider = process.env.AI_DEFAULT_PROVIDER ?? "anthropic";
  return provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5";
}
```

- Impact: Stored `generation.model` metadata can disagree with the model actually invoked if defaults change in `DEFAULT_MODEL_IDS`. Duplicates provider branching outside the abstraction.
- Fix: Derive metadata from the same `ModelSpec` / `DEFAULT_MODEL_IDS` map used by `getDefaultModel()`.
- Confidence: high

---

### [ARCH-006] Hand-rolled schedule math bypasses `computeSchedule`

- Location: `apps/web/src/lib/enrollments.functions.ts:54`, `apps/worker/src/sequence/anchor.ts:110-112`
- Severity: **medium** (convention drift → preview/executor drift risk)
- What: Enroll-with-existing-anchor paths compute `nextRunAt` as `anchor + delayMinutes * 60_000` instead of calling `computeSchedule` from `@quiksend/core/schedule` (used correctly in `apps/worker/src/sequence/context.ts:123`, `apps/web/src/lib/sequences.functions.ts:257`, `apps/web/src/routes/api/v1/enrollments.ts:65`).
- Impact: Ignores send windows, business-days-only, throttle spacing, and timezone math. Enrollments created via this path can run at different times than builder preview and normal enroll flow.
- Fix: Reuse `computeSchedule` (same helper pattern as `computeNextRunAt` in API v1 enrollments route).
- Confidence: high

---

### [ARCH-007] `APP_SCOPED_TABLES` incomplete for join/operational tables

- Location: `packages/db/src/tenancy-guard.test.ts:17-48`, schema: `packages/db/src/schema/prospects.ts:122-175`, `packages/db/src/schema/tasks.ts:60-92`
- Severity: **medium** (architectural gap)
- What: Guard lists 20 tables but schema also has org-scoped or sensitive tables without direct `organizationId`:
  - `listMember` — scoped via `listId` FK only
  - `importError` — scoped via `importBatch` FK only
  - `sendReservation` — scoped via `mailboxId` / `enrollmentId` FKs only
  - `jobLog` — no tenant column (global operational log)
- Impact: CI guard will not flag a bare `db.query.listMember.findMany()` or `sendReservation` query missing an org filter. Current call sites join through scoped parents (`apps/web/src/lib/prospects.functions.ts:248`, `apps/worker/src/sequence/reserve-slot.ts:49`), but future code could leak cross-tenant rows.
- Fix: Extend guard with FK-chain rules or add `organizationId` denormalized columns to high-risk join tables; document `jobLog` as intentionally global.
- Confidence: medium

---

### [ARCH-008] Provider-specific adapter types exported from `@quiksend/mail` root

- Location: `packages/mail/src/index.ts:33-43`
- Severity: **medium** (convention drift)
- What: Public package exports include `GmailAdapterConfig`, `MicrosoftAdapterConfig`, `NangoProxyClient`, and direct adapter factories alongside `createAdapterForMailbox`.
- Impact: Downstream code can import provider-specific types and bypass the single entry point (`createAdapterForMailbox`). Today only in-package tests use them; the export surface invites coupling.
- Fix: Export only `MailboxAdapter`, `createAdapterForMailbox`, and `createFakeAdapter` from the root; keep provider configs as internal or `./adapters/gmail` subpath exports for tests.
- Confidence: high

---

### [ARCH-009] Unit tests mock providers instead of using `createFakeAdapter`

- Location: `packages/mail/src/adapters/gmail.test.ts:5-20`, `packages/mail/src/adapters/smtp.test.ts:9-13`, `packages/mail/src/adapters/microsoft.test.ts` (same pattern); contrast `packages/mail/src/adapters/fake.ts:22-26`, `apps/worker/src/sequence/mailbox-adapter.ts:11-12`
- Severity: **medium** (convention drift)
- What: Foundations docs and `packages/mail/src/index.ts:7-8` state fake adapter is what unit tests inject. Adapter unit tests instead mock Nango/nodemailer and exercise real adapter code paths.
- Impact: Not wrong per se, but two test strategies coexist. Engine/load tests use `QUIKSEND_ENGINE_FAKE_MAIL=1`; adapter contract tests do not use the fake adapter at all.
- Fix: Document both strategies explicitly, or add integration-style tests that use `createFakeAdapter` for engine-level assertions.
- Confidence: high

---

### [ARCH-010] `_protected` layout trust model weaker than `orgFn` chokepoint

- Location: `apps/web/src/routes/_protected.tsx:7-14` vs `apps/web/src/lib/org-fn.ts:35-60`, `apps/web/src/lib/api/v1/middleware.ts:100-105`
- Severity: **medium** (layering gap)
- What:
  - `_protected` `beforeLoad` checks session existence only (`getSession()`), not active workspace or org membership.
  - `orgFn` / `authMiddleware` additionally require `activeOrganizationId` and a `member` row.
  - API v1 uses API-key → org resolution (`withApiAuth`), a third trust model.
- Impact: Authenticated users without an active workspace can load protected shell routes; data calls fail at server-fn layer with `NO_ACTIVE_WORKSPACE`. Not a direct data leak, but inconsistent authorization layering between UI gate and data gate.
- Fix: Align `_protected` `beforeLoad` with org membership checks (or redirect to workspace picker) so UI and server-fn gates match.
- Confidence: medium

---

### [ARCH-011] Zod input schemas not shared between server-fns and `/api/v1/*`

- Location: `apps/web/src/lib/prospects.functions.ts:139-188`, `apps/web/src/routes/api/v1/prospects.ts:16-23` (duplicate `prospectStatusSchema` / create shapes); same pattern across sequences, enrollments, webhooks
- Severity: **medium** (convention drift)
- What: Server functions define Zod schemas inline in `*.functions.ts`; API v1 routes redefine overlapping schemas locally. No shared `packages/*` or `apps/web/src/lib/schemas/` module.
- Impact: Public API and UI can accept different input shapes over time (field names, enums, limits).
- Fix: Extract shared request schemas per domain and import from both server-fns and API handlers.
- Confidence: high

---

### [ARCH-012] `packages/core` declares `@quiksend/config` dependency but never imports it

- Location: `packages/core/package.json:17-18`, `packages/core/src/index.ts:1-16`
- Severity: **low** (convention drift)
- What: `CLAUDE.md` allows config for logger; no file under `packages/core/src/` imports `@quiksend/config`, `env`, or `logger`. Core is effectively free of config at runtime.
- Impact: Dead dependency in package graph; slightly misleading boundary documentation.
- Fix: Remove unused dependency or add a documented reason if planned.
- Confidence: high

---

### [ARCH-013] Duplicate enrollment state writes in worker effect executor

- Location: `apps/worker/src/sequence/effects.ts:54-55` + `:170-178` + `:66-77`
- Severity: **low** (convention drift)
- What: `terminate` effect handler sets `state: reason` in `terminateInTx`, then `applyTransitionEffects` may set `state: nextState` again when `nextState !== working.enrollment.state`.
- Impact: Redundant writes; harmless if `reason === nextState` but adds confusion about single write path.
- Fix: Either let `terminate` effect only clear `nextRunAt` and rely on the final state write, or skip the outer state update when terminate already ran.
- Confidence: medium

---

### [ARCH-014] `terminateInTx` sets terminal state inside effect handler (acceptable interpreter pattern)

- Location: `apps/worker/src/sequence/effects.ts:170-178`
- Severity: **low** (informational — not a violation)
- What: Effect handlers mutate enrollment columns (state, step index, anchors, schedule) while `transition()` decides _what_ to do. This matches the documented interpreter model in `packages/core/src/state-machine/types.ts:2-4`.
- Impact: None if all callers route through `transition()` first (see ARCH-001/002/003 for exceptions).
- Fix: N/A — keep pattern, fix bypasses.
- Confidence: high

---

### [ARCH-015] Server-fn naming convention holds; intentional outliers only

- Location: `apps/web/src/lib/*.functions.ts` (13 files), `apps/web/src/lib/org-fn.ts:69-70`, `apps/web/src/lib/auth.functions.ts:5-8`
- Severity: **low** (ok)
- What: All data-touching server fns use `*.functions.ts` and compose `orgFn`. Exceptions are intentional infrastructure: `org-fn.ts` (middleware factory) and `auth.functions.ts` (session read, no tenancy).
- Impact: None.
- Fix: None required.
- Confidence: high

---

### [ARCH-016] Import conventions largely compliant

- Location: repo-wide spot check
- Severity: **low** (ok)
- What:
  - Relative imports use explicit `.ts`/`.tsx` extensions everywhere except generated `apps/web/src/routeTree.gen.ts` (excluded from lint per CLAUDE.md).
  - Type-only imports use `import type` or inline `type` imports (e.g. `apps/web/src/lib/compose.functions.ts:5`).
- Impact: None.
- Fix: None required.
- Confidence: high

---

## Section Pass/Fail Matrix

| #   | Check                               | Verdict                  | Notes                                                                                                                                                                         |
| --- | ----------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core` I/O purity          | **PASS**                 | No `@quiksend/{db,queue,mail,integrations}` or Node I/O imports in `packages/core/src/`                                                                                       |
| 2   | State machine / executor separation | **FAIL**                 | Worker pre-checks (ARCH-001), web compose interpreter (ARCH-002), web pause/resume (ARCH-003) bypass single transition+executor path                                          |
| 3   | Adapter contracts                   | **PASS** (minor drift)   | All three adapters implement `MailboxAdapter`; `createAdapterForMailbox` is engine entry point; fake adapter used in worker/load tests, not adapter unit tests (ARCH-008/009) |
| 4   | Tenancy chokepoint                  | **PASS** (gap)           | `org-fn.ts` is sole auth middleware; all data server-fns compose it; guard table list incomplete (ARCH-007)                                                                   |
| 5   | Package boundaries                  | **PASS** (one violation) | No `apps/*` in packages; core clean; mail→integrations (ARCH-004)                                                                                                             |
| 6   | Cross-package type ownership        | **PASS** (drift)         | `EnrollmentSnapshot` owned by core; `MailProvider` by mail; Zod schemas duplicated (ARCH-011)                                                                                 |
| 7   | Naming + conventions                | **PASS**                 | `*.functions.ts`, extensions, `import type`, pg enums follow `<table>_<field>`                                                                                                |
| 8   | Migration hygiene                   | **PASS**                 | 12 SQL files match `_journal.json` order; `prevId` chain intact 0000→0011; one commit per migration                                                                           |
| 9   | Effect leak (worker)                | **PASS**                 | All 9 kinds handled in `apps/worker/src/sequence/effects.ts:35-62`                                                                                                            |
| 10  | AI provider abstraction             | **FAIL**                 | `generate-email.ts` bypasses provider map (ARCH-005)                                                                                                                          |

---

## P2 Observations

### Schedule math duplication (ARCH-006)

Only enroll-with-existing-anchor paths hand-roll delay math. All other preview/executor/API paths use `computeSchedule`.

### MIME building — single source ✓

`buildMime` in `packages/mail/src/mime.ts` is the only MIME builder. Adapters wrap it via local `buildMimeFromOutbound` helpers; web compose/inbox/mailboxes call `buildMime` directly. No hand-rolled MIME strings elsewhere.

### Router pattern consistency (ARCH-010)

Three trust models coexist by design (session cookie UI, org middleware server-fns, API key REST). Overlap is acceptable; gap is UI layout vs org middleware strictness.

### Foreign key hierarchy ✓

Sensible cascade graph: `message.mailbox_id` → `mailbox.id` with `onDelete: "cascade"` (`packages/db/src/schema/mail.ts:77-80`). Deleting a mailbox removes its messages, which is appropriate for tenant-scoped mail storage. Enrollment→mailbox also cascades (`packages/db/src/schema/sequences.ts:102`).

---

## Positive Observations

1. **`packages/core` is genuinely pure** — state machine and schedule math have zero I/O imports; tests live alongside.
2. **Worker effect executor is complete** — all nine `Effect` kinds from `packages/core/src/state-machine/types.ts:66-75` have handlers; nested `transition()` calls after `auto_sent` in `handleSendAuto` follow the correct pattern.
3. **Migration chain is healthy** — phase-3 rebase fix held; snapshots form a monotonic `prevId` chain.
4. **Tenancy middleware is uniformly composed** — grep confirms every `*.functions.ts` data module imports `orgFn` except session-only auth.
5. **`createAdapterForMailbox` centralizes provider selection** — worker's `createMailboxAdapter` adds decryption and fake-mail test hook without forking provider logic.

---

## Recommended Fix Priority

1. **Unify state-machine interpretation** (ARCH-001, ARCH-002, ARCH-003) — highest structural risk.
2. **Decouple mail from integrations** (ARCH-004) — restore package layering.
3. **Fix AI metadata provider path** (ARCH-005) — small change, prevents audit drift.
4. **Route enroll-with-anchor scheduling through `computeSchedule`** (ARCH-006).
5. **Harden tenancy guard + align UI/API schemas** (ARCH-007, ARCH-010, ARCH-011) — incremental hardening.
