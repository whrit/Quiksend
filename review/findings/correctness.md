# Correctness & Bugs Review — V0

Read-only review of production-path defects. Each P1 invariant verified against source. File references use `path:line`.

---

## Executive summary

**15 P1 invariants:** 9 fully satisfied, 4 partially satisfied (gaps noted), 2 violated in code paths that can reach production.

**Highest-severity confirmed bugs:**

1. Step failures never transition enrollments to `failed` — `execute-step.ts` uses payload `attempt` (always `0`) instead of pg-boss retry metadata.
2. Scheduler tick clears `next_run_at` before the step succeeds; a failed/consumed step leaves enrollments stuck with `next_run_at = NULL`.
3. Suppression pre-check ignores the `suppression` table — manual/admin suppressions do not block outbound sends.
4. Auto-email sends use hardcoded CAN-SPAM placeholder URLs/addresses instead of real unsubscribe/postal data.
5. Send-slot reservation updates (`markReservationSent`) run outside the executor transaction, creating cap/accounting drift on partial failure.

---

## P1 invariant verification

### 1. Scheduler safety (no double-send)

| Check | Result | Evidence |
|-------|--------|----------|
| `FOR UPDATE SKIP LOCKED` | **PASS** | `apps/worker/src/sequence/tick.ts:10-15` |
| `next_run_at` nulled in same TX as claim | **PASS** | Claim + null in one transaction: `tick.ts:8-21` |
| pg-boss retry → idempotency check | **PASS** (when message row exists) | Retries re-invoke `executeStep` → `handleSendAuto` idempotency lookup: `effects.ts:248-265`, retry policy `idempotency.ts:6-11`, `register.ts:22-36` |

**Quoted claim SQL (`tick.ts:10-15`):**

```sql
SELECT id FROM enrollment
WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
ORDER BY next_run_at
LIMIT 100
FOR UPDATE SKIP LOCKED
```

**pg-boss retry policy (`idempotency.ts:6-11`):**

```ts
const STEP_RETRY_OPTIONS = {
  retryLimit: 4,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 43_200,
} as const;
```

**Gap / bug:** Tick nulls `next_run_at` inside the claim transaction (`tick.ts:18`) but enqueues the job **after** commit (`tick.ts:23-25`). If `enqueueSequenceStep` fails or the step job exhausts retries without rescheduling, the enrollment has `next_run_at = NULL` and will never be picked up again. See BUG-002.

Idempotency protects against double-send **only after** a `message` row with `status='sent'` exists. Send succeeding + DB rollback still allows a retry send (see BUG-005).

---

### 2. Slot reservation atomicity

| Check | Result | Evidence |
|-------|--------|----------|
| `pg_advisory_xact_lock(hashtext(mailboxId))` | **PASS** | `reserve-slot.ts:87` |
| Window/throttle/cap inside lock | **PASS** | All checks after lock: `reserve-slot.ts:87-111` |
| Send succeeds, reservation UPDATE fails | **FAIL** | See race analysis below |

**Quoted lock SQL (`reserve-slot.ts:87`):**

```sql
SELECT pg_advisory_xact_lock(hashtext(${mailboxId}))
```

**Race window analysis:**

1. `reserveSendSlot` opens its **own** transaction (`reserve-slot.ts:86-125`), commits a `held` reservation, then returns to `handleSendAuto`.
2. `adapter.send()` runs (`effects.ts:307-321`) — external I/O.
3. `markReservationSent` uses the global `db` handle, **not** the executor `tx` (`reserve-slot.ts:128-133`, called from `effects.ts:347`).
4. If the outer executor transaction rolls back after SMTP succeeds, the `message` insert is undone but the reservation may already be `sent` (autocommitted). Daily-cap counters (`countReservationsInWindow` includes `held` + `sent`, `reserve-slot.ts:54`) stay inflated; a retry may double-send because no `message` row exists.

---

### 3. Idempotency key

| Check | Result | Evidence |
|-------|--------|----------|
| Grep coverage | **PASS** | Worker: `idempotency.ts`, `effects.ts`. Mail adapters accept optional key: `adapter.ts:41` |
| Pre-send SELECT + skip if `sent` | **PASS** | `effects.ts:248-265` |
| Key derivation | **Variant** | `SHA-256(enrollmentId \| stepId \| attempt)` — pipe separator, not `||`: `idempotency.ts:21-24` |

**Collision domain:** Unique per `(enrollmentId, stepId, attempt)`. Same step retried with the same payload `attempt` (always `0` from tick/defer) collides intentionally.

**Gap:** Only skips when `existing?.status === "sent"`. Unique index `message_idempotency_key_unique` (`0006_phase6_tasks_reservations.sql:51`) prevents duplicate keys but surfaces as an error, not a skip.

---

### 4. Manual-first anchor capture

| Check | Result | Evidence |
|-------|--------|----------|
| compose → `sendComposedMessage` → anchor capture | **PASS** | `compose.functions.ts:203-212` |
| `normalizeMessageId` on anchor | **PASS** | `compose.functions.ts:174` |
| Next step scheduled from manual `sent_at` | **PASS** | `compose.functions.ts:375-381`; worker `anchor.ts:19`, `anchor.ts:52-58` |
| `enrollWithExistingAnchor` copies anchor ids | **PASS** | `enrollments.functions.ts:66-67`, `anchor.ts:127-128` |

**Gap (confidence: medium):** No validation that `data.mailboxId === enrollment.mailboxId` in compose. See BUG-006.

---

### 5. Threading headers on follow-ups

| Check | Result | Evidence |
|-------|--------|----------|
| `In-Reply-To` = single anchor id | **PASS** | `threading.ts:84`, `mime.ts:61-64`, `effects.ts:338` |
| `References` = chain oldest→newest ending at anchor | **PASS** | `threading.ts:74-86`, `effects.ts:339-342` |
| `Re:` without stacking | **PASS** | `threading.ts:64-68` |
| Same mailbox as anchor | **PASS** (when enrollment mailbox matches anchor) | `load-context.ts:47-53`, `effects.ts:309` |

---

### 6. Bounce classification

| Check | Result | Evidence |
|-------|--------|----------|
| Corpus expectations | **PASS** | 18/18 tests green |
| False positives return `null` | **PASS** | `bounce-09`, `bounce-10`, `bounce-11` in `bounce.test.ts:117-137` |
| 4.x.x soft, 5.x.x hard | **PASS** | `bounce.ts:110-112` |

**Note:** Expectations live in `bounce.test.ts`, not inline in `.eml` files.

**Low-confidence concern:** `classifyBounce` defaults to `"hard"` when unmatched (`bounce.ts:119`).

---

### 7. Thread matching

| Check | Result | Evidence |
|-------|--------|----------|
| Priority order | **PASS** | `inbound-matching.ts:64-117` |
| Normalization both sides | **PASS** | `inbound-matching.ts:37`, `inbound-matching.ts:121-127` |

---

### 8. Auto-reply detection

| Check | Result | Evidence |
|-------|--------|----------|
| Header checks | **PASS** | `auto-reply.ts:30-47` |
| Body heuristics only when headers clean | **PASS** | `auto-reply.ts:49-51` |
| “vacation” topic in real reply | **PASS** | `auto-reply.test.ts:60-66` |

---

### 9. CRM writeback idempotency

| Check | Result | Evidence |
|-------|--------|----------|
| Skip if `status='succeeded'` | **PASS** | `crm-writeback.ts:224-228` |
| Stable idempotency key | **PASS** | `execute-effects.ts:37-45`; unsubscribe `unsubscribe.ts:21` |
| Store provider `external_id` | **PASS** | `crm-writeback.ts:262-268` |

---

### 10. HMAC webhook signing / replay

| Check | Result | Evidence |
|-------|--------|----------|
| Canonical string | **PASS** | `webhook-deliver.ts:17-19` |
| Receiver verification documented | **PASS** | `docs/webhooks.md:22-46` |
| Timestamp window ≤ 300s | **PASS** | `webhook-deliver.ts:29-31` |

---

### 11. Unsubscribe end-to-end

| Check | Result | Evidence |
|-------|--------|----------|
| Token minted at send | **PASS** | `unsubscribe.ts:63-68`, `compose.functions.ts:133-136` |
| Handler verifies + inserts suppression | **PASS** | `unsubscribe.ts:47-129` |
| Suppression before CRM enqueue | **PASS** | `unsubscribe.ts:90-106` |

---

### 12. Suppression pre-check

| Check | Result | Evidence |
|-------|--------|----------|
| Called before outbound send | **PARTIAL** | `execute-step.ts:27-39` before transaction |
| Inside executor transaction | **FAIL** | Outside `db.transaction` at `execute-step.ts:61-63` |
| Checks suppression table | **FAIL** | `guards.ts:7-9` — prospect.status only |

See BUG-003.

---

### 13. State machine terminal absorption

| Check | Result | Evidence |
|-------|--------|----------|
| Terminals absorb events | **PASS** | `transition.ts:18-19`, `transition.ts:142-147` |
| `resume` only from `paused` | **PASS** | `transition.ts:25-27`; `paused` not terminal (`types.ts:21-27`) |

---

### 14. Schedule math edge cases

| Check | Result | Evidence |
|-------|--------|----------|
| Window boundary | **PASS** | `sending-window.ts:65-67`, `sending-window.ts:93-94` |
| Business days + DST | **PASS** (impl) | `formatInTimeZone` — `sending-window.ts:42` |
| Daily cap at exactly cap | **PASS** | `compute-schedule.ts:87-88`, `reserve-slot.ts:107-108` |
| Throttle at exactly minGap | **PASS** | `reserve-slot.ts:99`, `compute-schedule.ts:73-74` |

---

### 15. AI generation retry on schema failure

| Check | Result | Evidence |
|-------|--------|----------|
| Retries 2 times | **PASS** | `generate-email.ts:6,20-36` (3 total attempts) |

---

## Confirmed defects

### BUG-001: Step failures never mark enrollment `failed`

**Severity:** Critical  
**File:** `apps/worker/src/sequence/execute-step.ts:68-76`

`isDead` uses payload `attempt` (always `0` from `tick.ts:24`). `isDead = (0 + 1 >= 5)` is always false, so `handleStepFailure` never runs. pg-boss exhausts retries and drops the job; enrollment stays `active`.

---

### BUG-002: Tick clears `next_run_at` before step success

**Severity:** Critical  
**Files:** `apps/worker/src/sequence/tick.ts:18-24`

Claim nulls `next_run_at` before enqueue. Permanent failure leaves enrollment `active` with `next_run_at = NULL`, invisible to scheduler.

---

### BUG-003: Suppression table not enforced before send

**Severity:** High  
**Files:** `apps/worker/src/sequence/guards.ts:7-9`, `apps/web/src/lib/inbox.functions.ts:459-477`

Manual suppression writes `suppression` without updating `prospect.status`. Check runs outside executor transaction (TOCTOU on unsubscribe).

---

### BUG-004: Hardcoded CAN-SPAM placeholders in auto-email sends

**Severity:** High  
**File:** `apps/worker/src/sequence/effects.ts:287-291`

Placeholder unsubscribe URL and postal address in auto follow-ups vs real values in manual compose.

---

### BUG-005: Send reservation and message not atomic with SMTP

**Severity:** High  
**Files:** `apps/worker/src/sequence/reserve-slot.ts:86-133`, `apps/worker/src/sequence/effects.ts:234-360`

Nested reservation TX, SMTP inside outer TX, `markReservationSent` on separate `db` connection — cap leak and double-send risk.

---

### BUG-006: Compose mailbox can differ from enrollment mailbox

**Severity:** Medium  
**Files:** `apps/web/src/lib/compose.functions.ts:111-212`, `apps/worker/src/sequence/load-context.ts:47-53`

No validation `data.mailboxId === enrollment.mailboxId` when anchoring manual send.

---

## P2 findings

| Item | Status |
|------|--------|
| Migration numbering | OK — journal `0000`–`0011` matches SQL files |
| pgvector extension | OK — `0007_phase8prep_ai_interfaces.sql:1` |
| FK cascade on mailbox delete | **BUG** — messages cascade-delete (`0004_phase4_mailbox_message.sql:56`) |
| Timezone `getHours` | OK — uses `formatInTimeZone` |
| Concurrent admin writes | **confidence: low** — last-write-wins, no locking |
| JSON schema drift | Spot-check OK for prospect status enums |

---

## Review metadata

- **Mode:** Read-only source review + `bounce.test.ts` (18/18 pass)
- **Date:** 2026-07-01
