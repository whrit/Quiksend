# CORRECTNESS REVIEW — Phase 11

## Task

Read-only review of the Phase 11 shipped code through the correctness lens. Write
findings to `phase11-review/findings/correctness.md` following the format in
`phase11-review/CONTEXT.md`.

## Focus areas

### P1 — logic correctness of the load-bearing paths

1. **Routing decision table** (from spec § Phase 11B Mechanics)
   - Read `apps/worker/src/sequence/mailbox-router.ts` — is the decision table implemented for all 5 policy states × recipient gateway (SEG/non-SEG) × safe-mailbox availability × current-mailbox safety?
   - Specifically verify:
     - `policy=off` → route to current mailbox regardless of gateway
     - `policy=warn` + SEG + safe mailboxes exist + current not safe → auto-swap
     - `policy=warn` + SEG + no safe mailboxes → route to current + emit event
     - `policy=enforce` + SEG + no safe mailboxes → SKIP (paused enrollment)
     - `policy=enforce` + SEG + safe mailboxes exist + current not safe → auto-swap
   - **Anchor-threading exception**: verify `enrollment.anchor_message_id IS NOT NULL` correctly disables auto-swap (spec critical requirement)

2. **Gateway detection cascade** (`packages/mail/src/gateway-detect.ts`)
   - Verify order: MX → DMARC → SPF → fallback → unknown
   - Verify **split-brain case**: MX chain shows Proofpoint + Google Workspace — result MUST be `proofpoint` (SEG hop wins)
   - Verify MX timeout / SERVFAIL returns `unknown` with `confidence: low`, NOT throws
   - Verify empty MX (malformed domain) returns `unknown`
   - Fingerprint regex patterns from `gateway-fingerprints.json`: verify each regex is anchored + no ReDoS

3. **Canary injection scheduling** (`apps/web/src/lib/canary-injection.ts` or `sequences.functions.ts`)
   - Verify M canary sends at random positions per SEG with count >= N (default N=5, M=`seedsPerCampaign`)
   - Verify canary uses **same body as adjacent real send** with placeholder identity — spec critical (else SEG treats differently)
   - Verify canary sends do NOT advance enrollment state, do NOT trigger CRM writeback
   - Verify canary send seed pick honors user seeds first, provider seeds only if Pro

4. **Auto-pause evaluator** (`packages/core/src/deliverability/auto-pause.ts`)
   - Pure function — trace threshold logic
   - Verify minimum canary count before eval (spec says >= 3)
   - Verify per-(sequence, mailbox, gateway) grouping — not workspace-wide
   - Verify threshold percentage (default 80%) is comparable to actual delivered/total ratio
   - Verify no divide-by-zero when total=0

5. **State machine `no_safe_mailbox` event** (`packages/core/src/state-machine/transition.ts`)
   - Verify event handler exists + returns `nextState: "paused"` + `effects: [emit_event { type: "enrollment.no_safe_mailbox_for_gateway" }]`
   - Verify web + worker both apply this effect correctly (Wave 6 ARCH-002/003 fix)

### P1 continued — data invariants

6. **Gateway classification cache TTL + invalidation**
   - Verify `ttl_until` set correctly on insert (30 days high-confidence, 7 days low)
   - Verify `gateway.sweep_stale` cron actually re-classifies expired rows
   - Verify `reclassifyDomain` server-fn actually invalidates + re-fetches, not just wipes
   - Verify prospect back-fill after classification updates ALL matching prospects at that domain

7. **Canary polling arrival matching**
   - `canary-check.ts` searches IMAP for `X-Quiksend-Canary-Id` header
   - Verify header extraction handles `In-Reply-To` fallback (bounce path)
   - Verify arrival classification: inbox / spam / quarantine / not_found / bounced — all folders searched
   - Silent-drop 24h sweep: verify the SQL condition excludes pending canaries sent < 24h ago (not marked prematurely)

8. **Content sanitizer** (`packages/mail/src/content-sanitizer.ts`)
   - Verify `stripTrackingPixel`: pattern matches Quiksend's tracking domain but doesn't over-match legitimate images
   - Verify `stripExternalImages` size cap (spec: <100KB inline as base64, else strip)
   - Verify `preferPlainText` correctly drops HTML part when text/plain is complete (not when text is minimal)
   - Verify the sanitizer preserves MIME structure — Message-ID, headers, footers intact

### P2 — edge cases

9. **SEG throttle + 5-min per-domain gap** (`reserve-slot.ts`)
   - Verify `SEG_DAILY_CAP_PER_MAILBOX` sub-cap applies BEFORE mailbox daily cap (should apply lower of the two)
   - Verify 5-min per-domain gap uses `recipient_domain` populated at insert time
   - Verify the check inside the advisory lock (not outside — race window otherwise)

10. **Entry conditions**
    - `recipientGatewayIn` + prospect with `email_gateway = NULL`: does it proceed? (Spec doesn't say — pick a safe default)
    - `recipientGatewayNotIn` + prospect with `email_gateway = 'unknown'`: does it treat unknown as excluded?

11. **`isMailboxSafeForGateway` helper**
    - Verify: unknown/null gateway = OK for any mailbox
    - Verify: SEG gateway + `enterprise_safe && !auto_downgraded` = safe
    - Verify: SEG gateway + `enterprise_safe && auto_downgraded` = NOT safe (auto-downgrade overrides user declaration)
    - This is Foundation-shipped; verify no drift in downstream callers

12. **Deliverability snapshot refresh**

- `deliverability-snapshot.ts` — the 15-min rollup. Verify:
  - Window boundaries correct (rolling last 7/14/30 days? Or fixed windows?)
  - No off-by-one on end timestamps
  - Aggregation math: `arrivedInbox / canaryTotal` = `deliverabilityPct`
  - Snapshot table INSERT vs UPDATE strategy (should be UPSERT on `(org_id, mailbox_id, gateway, window_start)`)

## Do

- Read all state-machine test files touched in Wave 7 (Foundation + TAU + UPSILON + PHI)
- Look at `packages/core/src/deliverability/*.test.ts` for pure evaluator coverage
- Look at `apps/worker/src/sequence/mailbox-router.test.ts` for decision table coverage
- Look at `apps/worker/src/handlers/canary-check.test.ts` for arrival matching tests

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` — Mechanics sections
- Wave 5 correctness review (baseline): `review/findings/correctness.md`
