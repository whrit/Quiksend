# Completeness Review Findings

## Summary

- Files reviewed: ~95 (phase briefs, PRD sections 3-16, schema, worker engine, web routes/server fns, integrations, AI, scripts)
- Critical: 0, High: 4, Medium: 7, Low: 4
- Overall: **needs-fixes**

V0 is **substantially implemented** across Phases 2-10 (schema, worker engine, CRM sync/writeback, AI pipeline, public API, webhooks, analytics, self-host overlay). The largest **brief/PRD misalignments** are: (1) manual compose + inbox reply still **SMTP-only** while Gmail/Microsoft adapters exist for the **sequence engine**; (2) **suppression list not consulted** on the send path (only `prospect.status`); (3) **prospect detail C3** still shows placeholder sequence/message timelines; (4) several PRD items (CRM-to-list pull, reply sentiment, step `if_no_reply` at runtime) have schema/UI but not full behavior.

**Not verified in this review:** `pnpm check` green, live load-test execution, or RESULT.json claims (read-only audit).

---

## Phase-by-phase checklist

| Phase | Brief / AC | Status | Notes |
|-------|------------|--------|-------|
| **2** Prospects | C1, C3 | **Mostly complete** | `import_batch` / `import_error` inserted in `startImport`; error CSV in import UI; CRM columns + partial unique indexes on `prospect`/`company`. |
| **3** CRM | C2 | **Complete** | SF + HubSpot fetch/upsert; cursor advanced per page in `crm-sync`; Nango connect + mapping UI; signed `/api/nango/webhook`. |
| **4** Mail | B1-B3, E1 (partial) | **Partial** | Three adapters + DNS checker; compose UI exists; **compose / test-send / inbox reply reject non-SMTP mailboxes**. |
| **5** Sequences | D1-D5 | **Mostly complete** | Four step types, dnd-kit, A/B, round-robin enroll, `computeSchedule`; **`entry_condition` not enforced in worker**. |
| **6** Engine | E1-E4, D core | **Mostly complete** | Reservations, SKIP LOCKED, advisory lock, idempotency, `job_log` dead path; **`scripts/load-test-engine.ts` has fuller asserts than `pnpm load-test` entrypoint**. |
| **7** Inbox | G1-G4, I3 | **Partial** | Poller + suppression UI + filters; **G4 sentiment absent**; **I1 suppression table not checked pre-send**. |
| **8** AI | F1-F4, E1 AI | **Mostly complete** | Research, `generateObject`, humanizer, review/compose/sequence preview, value-prop CRUD. |
| **9** Writeback + analytics | H1-H3, J1-J3 | **Mostly complete** | Writeback log + events; SF Task / HS engagement paths; Recharts on analytics routes. |
| **10** API + hardening | I1-I2, K1-K2 | **Mostly complete** | v1 routes, OpenAPI, rate limit, webhooks, unsubscribe, prod compose, seed, docs. |

---

## V0 Definition of Done (PRD section 16)

| # | Must-have | Present? |
|---|-----------|----------|
| 1 | Manual-first to auto follow-up (demoable) | **Partial** - engine + anchor flows work; **OAuth mailboxes blocked on compose/reply** (`compose.functions.ts:123`, `inbox.functions.ts:305-306`). |
| 2 | Research-grounded AI + sources | **Yes** - `research_profile`, `cited_facts`, review UI (`packages/ai`, `prospects/$id/generate.tsx`). |
| 3 | Salesforce + HubSpot bidirectional (Nango) | **Yes** - inbound sync + outbound writeback handlers. |
| 4 | Supporting set | **Partial** - suppression storage yes, pre-send enforcement incomplete. |
| 5 | Quality gates | **Documented** - self-host docs present; load-test scripts split (COMP-009); `pnpm check` not run here. |

---

## Findings

### [COMP-001] Compose send rejects Gmail/Microsoft mailboxes (manual-first broken for OAuth)
- Location: `apps/web/src/lib/compose.functions.ts:123`
- Severity: **high**
- What: Send hard-fails for non-SMTP: `if (mailbox.provider !== "smtp") throw new Error("Only SMTP mailboxes are supported in Wave 1");`. Worker auto-sends use `createAdapterForMailbox` (`apps/worker/src/sequence/mailbox-adapter.ts:20`).
- Impact: V0 DoD manual first email cannot be demoed on Gmail/365 mailboxes.
- Fix: Route compose through `createAdapterForMailbox`; remove Wave 1 guard.
- Confidence: **high**

### [COMP-002] Inbox reply send is SMTP-only
- Location: `apps/web/src/lib/inbox.functions.ts:305-306`, `:331`, `:367-378`
- Severity: **high**
- What: `sendReply` throws for non-SMTP; placeholder unsubscribe `https://app.example.com/u/pending`.
- Impact: Unified inbox G3 fails for OAuth mailboxes.
- Fix: Adapter send + real unsubscribe minter.
- Confidence: **high**

### [COMP-003] Suppression table not checked before sends (PRD I1)
- Location: `apps/worker/src/sequence/guards.ts:7-9`, `execute-step.ts:27-28`
- Severity: **high**
- What: `isSuppressed()` only checks prospect status. Bounces/manual suppress insert `suppression` without always updating status (`inbound-handler.ts:71-81`, `inbox.functions.ts:444-477`).
- Impact: Suppressed emails may still receive sends.
- Fix: Query `suppression` in guards and compose/send paths.
- Confidence: **high**

### [COMP-004] Prospect detail C3 placeholders
- Location: `apps/web/src/routes/_protected/prospects/$id.tsx:339-348`
- Severity: **high**
- What: Static sequence/message sections; research on separate `/generate` route without detail link.
- Fix: Load enrollments/messages; link research profile.
- Confidence: **high**

### [COMP-005] Step entry_condition not enforced
- Location: `apps/web/src/lib/sequences.functions.ts:72-74`
- Severity: **medium**
- What: `if_no_reply` in UI/schema only; no worker/core enforcement.
- Confidence: **high**

### [COMP-006] PRD G4 sentiment/triage missing
- Severity: **medium**
- What: No inbound classification tags in schema/UI.
- Confidence: **high**

### [COMP-007] CRM pull into list UX missing
- Severity: **medium**
- What: Workspace-wide CRM sync only; no list-scoped pull UI.
- Confidence: **medium**

### [COMP-008] testMailboxSend SMTP-only
- Location: `apps/web/src/lib/mailboxes.functions.ts:316-348`
- Severity: **medium**
- Confidence: **high**

### [COMP-009] Weaker load-test entrypoint
- Location: `packages/db/src/load-test-scheduler.ts:149-179` vs `scripts/load-test-engine.ts:318-364`
- Severity: **medium**
- Confidence: **high**

### [COMP-010] captureManualAnchor not exported as orgFn
- Location: `apps/worker/src/sequence/anchor.ts:17`, `compose.functions.ts:289-401`
- Severity: **low**
- Confidence: **high**

### [COMP-011] Suppression UI lacks bulk actions
- Location: `apps/web/src/routes/_protected/settings/suppression.tsx`
- Severity: **low**
- Confidence: **high**

### [COMP-012] README intro stale
- Location: `README.md:7-12`
- Severity: **low**
- Confidence: **high**

### [COMP-013] H2 lazy CRM contact upsert
- Location: `crm-writeback.ts:121`
- Severity: **low**
- Confidence: **medium**

---

## Verified alignments

Phase 2 import batches/errors; Phase 3 dual CRM + webhook; Phase 4/4-rem adapters + DNS; Phase 5 builder/enrollment; Phase 6 engine invariants; Phase 7 poller; Phase 8 AI; Phase 9 writeback/analytics; Phase 10 API/webhooks/unsubscribe/self-host docs.

---

## Deferred vs missing

LinkedIn/warm-up/AI SDR: deferred per PRD section 3. OAuth compose/inbox: **missing**, not deferred.
