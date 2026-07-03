# ARCHITECTURE REVIEW — Phase 11

## Task

Read-only review of the Phase 11 shipped code through the architecture lens. Write
findings to `phase11-review/findings/architecture.md` following the format in
`phase11-review/CONTEXT.md`.

## Focus areas

### P1 — architectural invariants from prior phases (regressions?)

1. **`packages/mail` decoupled from `packages/integrations`** (Wave 5 CR-009)
   - Verify `packages/mail/package.json` does NOT depend on `@quiksend/integrations`
   - Verify `packages/mail/src/adapters/index.ts` `createAdapterForMailbox` accepts `NangoProxyClient` param, doesn't call `getNango()`
   - Verify `packages/mail/src/gateway-detect.ts` has NO DB or `@quiksend/integrations` imports
   - Any new Phase 11 module that imports from `packages/integrations` is a regression

2. **`packages/core` purity**
   - `packages/core/src/deliverability/*` — verify no DB imports, no I/O, no side effects
   - `packages/core/src/state-machine/entry-conditions.ts` extension — still a pure evaluator?
   - `packages/core/src/deliverability/auto-pause.ts` — verify pure function (takes stats + threshold → returns decision)
   - `packages/core/src/deliverability/mailbox-safety.ts` — verify types-only + pure logic

3. **Tenancy chokepoint (`orgFn` middleware)**
   - All new server-fns in `apps/web/src/lib/` compose `orgFn`? Verify:
     - `apps/web/src/lib/seed-inbox.functions.ts`
     - `apps/web/src/lib/deliverability.functions.ts`
     - `apps/web/src/lib/canary-injection.ts`
     - Extended parts of `prospects.functions.ts`, `mailboxes.functions.ts`, `sequences.functions.ts`, `analytics.functions.ts`
   - Admin-role gate on write ops (Deliverability Pro entitlement reads, workspace policy setters, mailbox safe toggle)

4. **State machine ownership**
   - `packages/core/src/state-machine/transition.ts` — new event `no_safe_mailbox` added correctly?
   - New event kinds added: is the `Event` union type extended cleanly OR did agents duplicate?
   - Web + worker both use `applyWebEffects` / effects.ts for consistency — no drift from Wave 6 OMEGA ARCH-002/003 fix?

### P1 — new Phase 11 architectural choices

5. **Shared enum + column foundation approach**
   - Foundation shipped enums + column additions + type stubs. Downstream tracks (TAU/UPSILON/PHI) reference these — verify NO duplicate type declarations or shadowing
   - Verify Foundation stubs (in `packages/mail/src/gateway-detect.ts` throw-NotImplementedError) properly replaced by TAU's real implementation

6. **Effect executor extensions**
   - Web-side `applyWebEffects` — did PHI add `emit_canary_bundle` kind? Or handle via a new effect kind?
   - Worker-side `effects.ts` — canary send handling added cleanly, or shoved into existing switch?
   - Verify UPSILON's sanitizer call + PHI's canary handling coexist without stepping on each other's effects

7. **Package boundaries**
   - `packages/mail/src/gateway-detect.ts` — pure DNS + fingerprint match, no DB
   - `packages/mail/src/gateway-fingerprints.json` — externalized as spec required (audit trail)
   - `packages/mail/src/content-sanitizer.ts` — pure MIME transformation
   - `apps/worker/src/handlers/canary-check.ts` — orchestration only; IMAP polling extracted to a reusable helper?
   - `apps/worker/src/handlers/gateway-detect.ts` — orchestration; MX resolution delegated to `packages/mail`?

8. **Data model**
   - `packages/db/src/schema/deliverability.ts` — consolidated file good, but is the file getting too big? (Foundation started, TAU added gateway_classification, PHI added 3 more tables)
   - Consider splitting into `deliverability-detection.ts`, `deliverability-canary.ts`, `deliverability-snapshots.ts` — or note that consolidation is fine
   - Verify all cross-table relations declared correctly (relations() calls)

### P2 — patterns + design cleanliness

9. **UI route organization**
   - `_protected/deliverability/index.tsx` (grid page) + `_protected/settings/deliverability.tsx` (settings) — two routes, distinct concerns. Verify separation is intentional
   - `_protected/sequences/$id/index.tsx` — three sections (TAU outlook, UPSILON warning, PHI live indicator) merged. Reviewable? Or spaghetti?

10. **Migration boundary**
    - 4 migrations shipped (0015 Foundation, 0016 TAU, 0017 UPSILON, 0018 PHI). Verify each is additive-only (no destructive changes). Verify FK cascades sensible.

11. **Provider-managed vs user-provided seed model**
    - `seed_inbox.organization_id NULL` for provider-managed — verify the tenancy guard test extension recognizes this
    - The design chose "shared table with nullable org" over "separate tables" — verify no accidental leakage in queries

12. **Deprecated / legacy patterns**
    - Any Phase-10 code that Phase 11 should have replaced but didn't?
    - Any dead code introduced by Wave 7 (functions defined but never called — my session already caught `seedCanaryFixture` in load-test-engine.ts; anything else?)

### P3 — informational

13. **Naming consistency**
    - `enterprise_safe` vs `enterpriseSafe` — mailbox column
    - `email_gateway` vs `emailGateway` on prospect
    - `deliverabilityPct` vs `deliverability_pct` — schema vs code
    - Verify Drizzle `casing: "snake_case"` is honored, no manual overrides

14. **Cross-package type imports**
    - `packages/core/src/deliverability/mailbox-safety.ts` imports `EmailGateway` from `@quiksend/mail/gateway-detect`
    - Verify this is `import type` (should be — spec required)
    - Any other cross-package type leakage?

## Do

- Compare `packages/mail/package.json` current dependencies vs what CR-009 established
- Check the new `packages/db/src/schema/deliverability.ts` file for internal consistency (all tables in one file, foreign keys declared)
- Run `pnpm typecheck` mentally through the imports — any circular deps?

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` — Architecture sections
- CLAUDE.md — package boundaries, tenancy chokepoint
- Wave 5 architecture review (baseline): `review/findings/architecture.md`
