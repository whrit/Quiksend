# TRACK BETA — OAuth Mailboxes + PRD Gap-Close

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`fix/wave5-beta-oauth-prd` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md` + `WAVE_CONTEXT.md` (root) + `wave5/WAVE_CONTEXT.md`
2. `review/CONSOLIDATED.md`
3. `review/findings/completeness.md`
4. `docs/implementations/prds/design_implementation_v1.md` — sections C1, C2, C3, D3,
   E1, G3, G4
5. `packages/mail/src/adapters/index.ts` — `createAdapterForMailbox` handles gmail/microsoft/smtp
6. `apps/worker/src/sequence/mailbox-adapter.ts` — how the worker uses it

## Findings assigned (9)

- **CR-006 HIGH** — OAuth compose blocked (only SMTP allowed)
- **COMP-002 HIGH** — Inbox reply blocked for OAuth
- **COMP-004 HIGH** — Prospect detail C3 shows static placeholders instead of real
  sequence/message timeline
- **COMP-005 MEDIUM** — Step `entry_condition` (e.g. `if_no_reply`) exists in schema/UI
  but never enforced at runtime
- **COMP-006 MEDIUM** — PRD G4 sentiment/triage tags on inbound not implemented
- **COMP-007 MEDIUM** — PRD C2 CRM-to-list pull UX missing
- **COMP-008 MEDIUM** — `testMailboxSend` SMTP-only
- **COMP-011 LOW** — Suppression UI lacks bulk actions
- **COMP-013 LOW** — H2 lazy CRM contact upsert

## Documentation lookup (mandatory)
Context7 MCP for:
- **@nangohq/node** — using cached OAuth-token adapter for send + fetch
- **`ai` SDK** — `generateText` for lightweight sentiment classification
- **TanStack Router** — data-loading, route params
- **shadcn Sheet + Dialog** — for the CRM-to-list picker UI

## Tasks

### T1 — Fix CR-006 + COMP-002 + COMP-008 (OAuth mailboxes end-to-end)

**Location**: `apps/web/src/lib/compose.functions.ts:123`, `apps/web/src/lib/inbox.functions.ts:305-306`, `apps/web/src/lib/mailboxes.functions.ts:316-348`

Replace the SMTP-only guards with `createAdapterForMailbox(mailbox)` from
`@quiksend/mail/adapters`. Same call the worker uses. The adapter registry already
handles all three providers correctly.

Tests:
- `apps/web/src/lib/compose.functions.test.ts` — new. Mock `createAdapterForMailbox` to
  return a fake adapter. Verify: providing a gmail mailbox → adapter's send is called
  with the right MIME + threading.
- Same for `inbox.functions.test.ts` (sendReply) and `mailboxes.functions.test.ts`
  (testMailboxSend).

### T2 — Fix COMP-004 (Prospect detail C3 timeline)

**Location**: `apps/web/src/routes/_protected/prospects/$id.tsx:339-348`

Currently shows placeholder empty state for "Sequence history" and "Messages". Load
real data:
- Enrollments for this prospect (`enrollment WHERE prospect_id = ? AND organization_id = ?`)
  with their sequence name, state, current_step_index, last activity.
- Messages for this prospect (both outbound + inbound) ordered by sent/received desc,
  with subject + timestamp + status badge.
- Link to research profile if it exists (`research_profile WHERE prospect_id = ?`) —
  route to `/prospects/$id/generate`.

Wire via new server fns in `apps/web/src/lib/prospects.functions.ts` (extend the
existing file additively):
- `getProspectEnrollments({ prospectId })` — org-scoped
- `getProspectMessages({ prospectId, cursor?, limit? })` — org-scoped, keyset paginated

Add to prospect detail page. Match visual style of the existing shell.

### T3 — Fix COMP-005 (entry_condition worker enforcement)

**Location**: `apps/web/src/lib/sequences.functions.ts:72-74` (schema + UI already exist)

Currently `entry_condition` is persisted on `sequence_step` but never enforced when
the executor decides whether to run a step.

Add a pure module `packages/core/src/state-machine/entry-conditions.ts`:
```ts
export interface EnrollmentContextForCondition {
  hasReplyOnThread: boolean;
  hasBounceOnThread: boolean;
  currentStepIndex: number;
  lastReplyAt: Date | null;
}
export function evaluateEntryCondition(
  condition: EntryCondition | null,
  ctx: EnrollmentContextForCondition,
): { proceed: boolean; skipReason?: string }
```

The state machine's `tick` handler in `packages/core/src/state-machine/transition.ts`
gets a new event variant `{ kind: "tick", at: Date, entryCondition: EntryCondition | null, evaluationContext: EnrollmentContextForCondition }` — or the executor evaluates the
condition before invoking `transition()` and passes a decision flag.

Coordinate with Track ALPHA: ALPHA owns `apps/worker/src/sequence/execute-step.ts`.
Do NOT touch that file. Instead, contribute the pure module to `packages/core` and
add a note in your RESULT explaining that ALPHA needs to wire it into the tick handler
(they can pick it up).

**If ALPHA hasn't wired it by the time your branch is ready, ship the module + a
`NEEDS.md` note. Consolidation will handle the wiring.**

Unit test the pure module: `if_no_reply` + `hasReplyOnThread=true` → skip. Else → proceed.

### T4 — Fix COMP-006 (sentiment/triage tags)

Extend `message` schema with a nullable `sentiment` column (pg enum: `"interested"`,
`"not_now"`, `"objection"`, `"out_of_office"`, `"unsubscribe_request"`, `null`).
Add migration.

In `apps/worker/src/sequence/inbound-handler.ts` — when an inbound reply is received,
call a new function `classifyInboundSentiment(inbound: InboundEmail): Promise<Sentiment | null>`
that uses `generateText` from `@quiksend/ai` with a small prompt. Store the result on
the `message` row.

- Skip if `env.ANTHROPIC_API_KEY` and `env.OPENAI_API_KEY` are BOTH unset (leave sentiment null).
- Timeout the classification at 5s; on timeout log warning + leave null.
- Simple prompt: "Classify this reply into one of: interested, not_now, objection,
  out_of_office, unsubscribe_request, or null. Return only the label."

Show the badge in the inbox thread list UI (`apps/web/src/routes/_protected/inbox/index.tsx`).

Testing: unit test the classifier with mock model.

### T5 — Fix COMP-007 (CRM-to-list pull UX)

**Location**: `apps/web/src/routes/_protected/settings/crm/index.tsx`

Add a "Pull contacts to list" action per connection. Opens a dialog:
- Choose target list (existing or new)
- Choose filter (all contacts, contacts modified in last N days, contacts tagged X)
- Confirm → enqueue a `crm.sync` job with a `targetListId` payload extension.

Update `apps/worker/src/handlers/crm-sync.ts` (extend additively — this file is shared
but the extension is minimal) to accept `targetListId` and, after upserting each
prospect, insert into `list_member`.

Actually — updating crm-sync.ts might collide with Track DELTA's architectural cleanup.
Coordinate: if DELTA needs this file, write to a NEW file `apps/worker/src/handlers/crm-sync-to-list.ts` that wraps the existing handler + adds list membership.

### T6 — Fix COMP-011 (Suppression UI bulk actions)

**Location**: `apps/web/src/routes/_protected/settings/suppression.tsx`

Add row-select checkboxes + "Delete selected" + "Export CSV" bulk actions. Match the
prospects table pattern (Phase 2 built it — use TanStack Table row selection).

### T7 — Fix COMP-013 (H2 lazy CRM contact upsert)

**Location**: `apps/worker/src/handlers/crm-writeback.ts:121`

Currently CRM contact upsert only fires on certain events. PRD H2 wants it to fire on
every new prospect creation.

Add a hook: after `createProspect` (either from CSV import or manual add), enqueue a
`crm.writeback` job with `event_type: 'contact_upsert'` if the workspace has any
active `crm_connection`.

`apps/web/src/lib/prospects.functions.ts` `createProspect` extension: at the end,
`if (await hasAnyCrmConnection(orgId)) await enqueue("crm.writeback", { ... })`.

## Files owned (strict)

- `apps/web/src/lib/compose.functions.ts` — WAIT, this is also ALPHA territory for BUG-006.
  **Coordination**: ALPHA owns validation of mailboxId. BETA owns replacing the SMTP-only
  throw with adapter registry. These two changes touch DIFFERENT lines; BETA's changes
  land at lines 111-123 (the throw), ALPHA's at lines 111-212 (adding validation).
  Communicate via NEEDS.md if a merge conflict looks likely. Both should keep changes
  minimal.
- `apps/web/src/lib/inbox.functions.ts` — WAIT, ALPHA also touches this for `suppressEmail`
  → prospect.status. Coordinate: BETA touches lines 305-306 (SMTP-only throw), ALPHA
  touches `suppressEmail` implementation.  Different concerns, same file.
- `apps/web/src/lib/mailboxes.functions.ts` (testMailboxSend)
- `apps/web/src/routes/_protected/prospects/$id.tsx` (timeline extension)
- `apps/web/src/routes/_protected/settings/crm/index.tsx` (pull-to-list UI)
- `apps/web/src/routes/_protected/settings/suppression.tsx` (bulk actions)
- `apps/web/src/routes/_protected/inbox/index.tsx` (sentiment badge column)
- `apps/web/src/lib/prospects.functions.ts` — EXTEND additively for new server-fns
  (getProspectEnrollments, getProspectMessages, createProspect CRM hook)
- `packages/core/src/state-machine/entry-conditions.ts` — NEW module
- `packages/core/src/state-machine/entry-conditions.test.ts` — NEW
- `packages/db/src/schema/mail.ts` — extend `message` with `sentiment` column
- `apps/worker/src/handlers/crm-sync-to-list.ts` — NEW if wrapping
- `packages/ai/src/classify/sentiment.ts` — NEW module + test

## Do NOT touch

- `apps/worker/src/sequence/**` — ALPHA
- `packages/mail/**` — DELTA
- `packages/db/src/schema/{prospects,tasks,api,writeback,ai,sequences,crm}.ts` — EPSILON adds indexes; only touch `mail.ts` for the sentiment column
- Tests for existing modules unrelated to your changes — ZETA

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name wave5_beta_sentiment
pnpm db:migrate
pnpm check
```

Manual smoke:
- Connect a Gmail mailbox (or mock via Nango stub if no live creds) and confirm compose
  attempts to send via the Gmail adapter path (not the SMTP throw).
- Load a prospect detail page for a prospect with real enrollments + messages;
  confirm timeline renders.
- Configure a sequence with `if_no_reply` on step 2; enroll a prospect who replies on
  step 1; verify step 2 is skipped.
- Send yourself a reply mentioning "not interested"; verify sentiment=`objection`.

## Result

```json
{
  "status": "ok",
  "track": "BETA",
  "findings_addressed": ["CR-006", "COMP-002", "COMP-004", "COMP-005", "COMP-006", "COMP-007", "COMP-008", "COMP-011", "COMP-013"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
