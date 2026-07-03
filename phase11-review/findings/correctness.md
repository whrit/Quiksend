# Correctness Review Findings

## Summary
- Files reviewed: ~28 (routing, gateway detect, canary injection/send/check, auto-pause, state machine, reserve-slot, entry-conditions, content sanitizer, gateway cache, deliverability snapshot, tests)
- Critical: 0, High: 2, Medium: 5, Low: 2
- Overall: needs-fixes

P1 load-bearing paths (routing decision table, anchor exception, gateway cascade, auto-pause pure evaluator, `no_safe_mailbox` state machine, SEG throttle, mailbox safety helper, gateway cache TTL/sweep, silent-drop 24h sweep) are largely correct. The highest-impact gaps are in the canary path: unsanitized canary bodies diverge from real SEG sends, and bounce/`In-Reply-To` arrival classification is incomplete.

## Findings

### [CORR-001] Canary sends skip SEG content sanitizer — deliverability signal diverges from real sends

- **Location**: `apps/worker/src/deliverability/canary-send.ts:74-76`, `apps/worker/src/sequence/effects.ts:358-371`
- **Severity**: high
- **Confidence**: high
- **What**: Real auto-email sends to SEG-tagged prospects run `sanitizeForSeg()` (strip tracking pixels, external images, prefer plain text) before adapter delivery. `materializeCanarySend()` renders the same step template but never calls the sanitizer — it sends the raw HTML body to the seed inbox.
- **Impact**: SEGs analyze content. If canaries carry tracking pixels / external images / HTML-heavy bodies that real campaign sends strip, canaries may be filtered differently than production mail. Deliverability percentages would not reflect actual prospect-facing send behavior — the core Phase 11C value proposition is undermined.
- **Fix**: Apply the workspace `contentSanitizerEnabled` policy and `sanitizeForSeg()` (or `sanitizeForSegAsync`) in `materializeCanarySend()` using the seed inbox's gateway (or the campaign SEG being tested) before `buildMime` / `adapter.send`, mirroring `handleSendAuto`.

### [CORR-002] `bounced` arrival status is never set during canary polling

- **Location**: `apps/worker/src/handlers/canary-check.ts:121-129`, `apps/worker/src/deliverability/seed-imap.ts:113-116`
- **Severity**: high
- **Confidence**: high
- **What**: The `canary_arrival_status` enum includes `bounced`, and `deliverability-snapshot.ts` counts bounced rows in `canary_silent_dropped`, but `folderToStatus()` only maps spam/quarantine/inbox. `extractCanaryToken()` searches only the `X-Quiksend-Canary-Id` header line — there is no bounce/NDR detection path and no `In-Reply-To` fallback.
- **Impact**: Hard bounces to seed inboxes are classified as `silent_drop` after 24h (or left `pending`), inflating silent-drop counts and potentially triggering false auto-pauses. Bounce forensics in the deliverability grid are wrong.
- **Fix**: Extend `extractCanaryToken()` to also match the canary UUID in `In-Reply-To` / `References` / bounce body text. Add NDR heuristics (e.g., `Content-Type: multipart/report`, `Auto-Submitted: auto-replied`) and set `arrival_status = 'bounced'` when a matching bounce is found in any searched folder.

### [CORR-003] Canary step selection ignores injected positions — not "adjacent real send"

- **Location**: `apps/web/src/lib/canary-injection.ts:85-114`, `apps/worker/src/deliverability/canary-send.ts:57-58`
- **Severity**: medium
- **Confidence**: high
- **What**: `pickRandomPositions()` chooses step indices used only to compute `startAfter` delay (`positions[i] * 5` minutes). At send time, `materializeCanarySend()` picks the step via `hashToIndex(canaryToken, autoSteps.length)`, independent of the injected position.
- **Impact**: A canary scheduled at step 4 may send step 1's template. Spec requires "same body template as an adjacent real send in the campaign" at the injected position so content and timing align with surrounding real sends.
- **Fix**: Persist the chosen `stepIndex` on `canary_send` at injection time and use it in `materializeCanarySend()` instead of `hashToIndex`.

### [CORR-004] `injectionStrategy` config accepted but not implemented

- **Location**: `apps/web/src/lib/canary-injection.ts:121-134`, `packages/core/src/deliverability/canary-config.ts:6-16`
- **Severity**: medium
- **Confidence**: high
- **What**: `CanaryConfig.injectionStrategy` supports `random_position`, `first_then_last`, and `every_nth`. `injectCanariesForEnrollment()` always uses `pickRandomPositions()` regardless of the configured strategy.
- **Impact**: Users or sequences configured with non-random strategies get random behavior silently. Position distribution may not match operational expectations (e.g., bookend or every-Nth coverage).
- **Fix**: Branch on `config.injectionStrategy` to implement the three strategies from the spec, or remove unsupported enum values from the schema until implemented.

### [CORR-005] Canary sends bypass `send_reservation` throttle path

- **Location**: `apps/worker/src/deliverability/canary-send.ts:102-128`, `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:1252-1253`
- **Severity**: medium
- **Confidence**: medium
- **What**: Spec states canary sends are "scheduled via the same `send_reservation` mechanism — treated identically to real sends." Canaries are enqueued as standalone `canary.send` jobs and sent directly via adapter/SMTP with no `reserveSendSlotInTx()` call — no SEG sub-cap, per-mailbox daily cap, or 5-minute per-domain gap applies.
- **Impact**: Canary volume does not compete with real sends for mailbox capacity, so deliverability measurements may be taken under different throttle conditions than production traffic. Unlikely to cause double-sends, but timing and rate-limit realism diverge.
- **Fix**: Either route canaries through `reserveSendSlotInTx()` (with a synthetic enrollment or canary-specific reservation type), or document this as an intentional simplification and adjust the spec.

### [CORR-006] Deliverability snapshot hardcodes 7-day window; grid supports 14/30 days

- **Location**: `apps/worker/src/handlers/deliverability-snapshot.ts:35-49`, `apps/web/src/lib/deliverability.functions.ts:47-54`
- **Severity**: medium
- **Confidence**: high
- **What**: `refreshDeliverabilitySnapshots()` always aggregates `sent_at >= date_trunc('day', now() - interval '7 days')` with a fixed `window_start` of that same truncated date. `getDeliverabilityGrid({ windowDays })` accepts 7/14/30 but filters snapshots by `windowStart >= now - windowDays` — only the single 7-day rollup row exists per (org, mailbox, gateway).
- **Impact**: 14- and 30-day grid views show the same 7-day data (or empty cells), misrepresenting longer-window deliverability trends.
- **Fix**: Parameterize the snapshot job to write rows per window (7/14/30) or compute the aggregation dynamically in `getDeliverabilityGrid` for the requested `windowDays`.

### [CORR-007] `preferPlainText` drops HTML on any non-empty text, not "complete" plain text

- **Location**: `packages/mail/src/content-sanitizer.ts:97-98`, `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md:859-860`
- **Severity**: low
- **Confidence**: medium
- **What**: Spec says to drop the HTML part "if the text version is complete." Implementation checks only `text.trim().length > 0`, so a minimal plain-text stub (e.g., `"Hi"`) causes full HTML discard even when HTML carries the substantive message.
- **Impact**: SEG-destined sends with incomplete plain-text alternatives may lose primary content, producing truncated or confusing emails.
- **Fix**: Add a completeness heuristic (e.g., plain-text length ≥ fraction of stripped HTML length, or explicit `text/plain` completeness flag from the composer) before zeroing `html`.

### [CORR-008] `classifyArrivalFolder` defaults unknown folder names to inbox

- **Location**: `apps/worker/src/deliverability/seed-imap.ts:151-164`
- **Severity**: low
- **Confidence**: medium
- **What**: Folders that do not match inbox/spam/junk/quarantine substrings fall through to `return "inbox"`. Messages found in provider-specific holding folders (e.g., "Clutter", "Other") are reported as inbox arrivals.
- **Impact**: Deliverability percentages may be optimistically biased when seeds use non-standard folder layouts.
- **Fix**: Return a distinct classification (or `not_found` until a known folder matches) for unrecognized folder names; allow per-provider folder maps.

## Positive observations

- **Routing decision table** (`apps/worker/src/sequence/mailbox-router.ts:87-122`) implements all spec branches: `off`/non-SEG passthrough, warn/enforce auto-swap, warn-at-risk, enforce skip, and anchor-threading exception (`enrollment.anchorMessageId != null` disables swap at `mailbox-router.ts:107-112`). Integration test `seg-routing.integration.test.ts` confirms enforce-pause + event emission end-to-end.
- **Gateway detection cascade** (`packages/mail/src/gateway-detect.ts:225-297`) follows MX → DMARC → SPF → low-confidence MX fallback → unknown. Split-brain Proofpoint + Google resolves to `proofpoint` (`gateway-detect.test.ts:65-78`). DNS timeout/SERVFAIL/empty MX return `unknown` with low confidence without throwing.
- **MX fingerprint regexes** in `gateway-fingerprints.json` are end-anchored (`$`) with simple character classes — no unbounded backtracking risk.
- **Auto-pause evaluator** (`packages/core/src/deliverability/auto-pause.ts:24-41`) is pure, enforces minimum 3 canaries, avoids divide-by-zero, and compares rounded `delivered/total` against threshold. Worker grouping is per `(sequence_id, mailbox_id, gateway)` (`canary-check.ts:141-152`), not workspace-wide.
- **State machine `no_safe_mailbox`** (`packages/core/src/state-machine/transition.ts:112-117`) returns `paused` + `enrollment.no_safe_mailbox_for_gateway` effect; worker applies via `effects.ts:274-277` and web `effect-executor.ts:181-193`.
- **Gateway cache TTL + sweep** (`apps/worker/src/handlers/gateway-detect.ts:19-24`, `203-223`): 30-day high/medium, 7-day low, 24-hour unknown/DNS-failure; daily `gateway.sweep_stale` re-classifies expired rows and back-fills prospects on gateway change. `reclassifyDomain` (`prospects.functions.ts:1132-1140`) deletes cache + re-enqueues detect + scoped apply.
- **SEG throttle + domain gap** (`apps/worker/src/sequence/reserve-slot.ts:115-172`): `Math.min(mailboxCap, segCap)` for SEG recipients; 5-minute same-domain gap uses `recipientDomain` at insert; all checks run inside `pg_advisory_xact_lock`.
- **`isMailboxSafeForGateway`** (`packages/core/src/deliverability/mailbox-safety.ts:22-35`) matches spec: null/unknown/non-SEG → safe; SEG requires `enterpriseSafe && !enterpriseSafeAutoDowngraded`. Unit tests cover all branches.
- **Entry conditions** (`packages/core/src/state-machine/entry-conditions.ts:47-63`) safely proceed when `recipientGateway` is null/unknown — unclassified prospects are not blocked by gateway predicates (`entry-conditions.test.ts:70-74`).
- **Silent-drop 24h sweep** (`apps/worker/src/handlers/canary-check.ts:50-58`) correctly requires `sent_at < now() - 24 hours` before marking `silent_drop`, avoiding premature classification of recent pending canaries.
- **Canary isolation from enrollment state**: injection creates standalone `canary_send` rows without `enrollment_id`; materialization does not call `transition()` or emit `message.sent`, so enrollments do not advance and CRM writeback is not triggered (`execute-effects.ts:34-43` only maps `message.sent` / enrollment terminal events).
