# PHASE-7: Replies + bounces + unified inbox — Track J

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/phase-7-inbox` from `main` (worktree isolated).

## Context
Read at repo root first, in order:
1. `CLAUDE.md`
2. All `WAVE_CONTEXT.md` files (root + wave3 + wave4)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` section "Phase 7"
4. `packages/mail/src/bounce.ts` — Phase 7-prep landed the DSN parser
5. `packages/mail/src/inbound-matching.ts` — Phase 7-prep landed the thread matcher
6. `packages/mail/src/threading.ts` — `normalizeMessageId`
7. `packages/core/src/state-machine/transition.ts` — the `reply_received` + `bounce_received` events

Phase 6 (Wave 3) is live: sends happen, threading is captured, enrollments are
driven. Phase 7 closes the loop — detect inbound replies + bounces, feed them
back to the engine, surface an inbox UI.

## Documentation lookup (mandatory)
Context7 MCP for:
- Gmail API v1: `users.history.list` + `users.messages.get(format="raw")` for
  inbound polling
- Microsoft Graph: `/me/mailFolders/inbox/messages/delta` for delta polling
- **imap-simple** or **imapflow** — pick one (verify via Context7 which is current);
  we need IMAP for SMTP-based mailboxes
- **mailparser** — parsing raw MIME → structured Inbound object

## Tasks

### T1 — Schema (`packages/db/src/schema/suppression.ts`)
- **`suppression`** — id (uuid pk), organization_id (text FK cascade),
  value (text notNull, lowercased — usually an email; could be a domain for
  workspace-wide blocks), value_type text default 'email' ('email' | 'domain'),
  reason pg enum ('bounce', 'unsubscribe', 'manual', 'complaint') notNull,
  source_message_id (uuid nullable FK → message.id set null),
  notes text nullable, created_by_user_id (text FK nullable),
  timestamps.
  Unique `(organization_id, value)`.

Barrel + tenancy guard + testing.ts (per WAVE_CONTEXT pattern).

`packages/db/src/schema/mail.ts` needs a follow-up ALTER for the message
table's inbound columns to be non-nullable now (`received_at` etc). Since Phase
4 back-half pre-baked those as nullable, Track J's migration just adds indexes:
- `(organization_id, direction, received_at DESC)` — inbox list
- `(organization_id, status)` — bounced/failed filters

### T2 — Inbound poller (`apps/worker/src/handlers/mailbox-poll.ts`)
Register a `mailbox.poll` handler:
```ts
registerHandler("mailbox.poll", async ({ mailboxId, since }) => { ... });
```

Load mailbox → dispatch by provider:
- **Gmail** — call `users.history.list` since last `history_id` (stored on
  mailbox as `poll_cursor jsonb`). Fetch each message with `format=raw`, parse
  MIME via `mailparser`, feed to matcher/bouncer.
- **Microsoft** — delta query via `/me/messages/delta` since `delta_link`.
- **SMTP/IMAP** — IMAP `UID SEARCH SINCE <date>` + `UID FETCH`.

Handle cursor expiration (Gmail 404/410 on stale history_id): fall back to full
resync from now-2h.

Per inbound message:
1. Normalize Message-Id + In-Reply-To + References
2. Match against outbound `message.message_id_header` via
   `matchInboundToOutbound` (Phase 7-prep helper)
3. If bounce (via `parseBounce`): create inbound message with
   `direction='inbound'`, `status='received'`, `bounce_type`, `dsn` populated.
   Emit `bounce_received` event to the engine — hard bounce → engine
   terminates enrollment + Track J inserts `suppression`.
4. If reply: create inbound message, link to enrollment via matched outbound
   → emit `reply_received` with `stopOnReply` from sequence settings → engine
   transitions to `replied` state.
5. Auto-reply detection: `Auto-Submitted: auto-replied` header OR
   `X-Autorespond` OR common OOO phrase heuristics — configurable per workspace
   (add `settings.stop_on_ooo` bool, default false).

Add `mailbox.poll` scheduling: on worker boot, `boss.schedule("mailbox.poll", "*/2 * * * *", {}, {tz: "UTC"})` (verify pg-boss v12 cron syntax via Context7).
Actually cleaner: enqueue one `mailbox.poll` per active mailbox from a
`mailbox.poll.tick` scheduled job every 2 min.

### T3 — Engine wiring (`apps/worker/src/sequence/`)
Extend the executor (Track G from Wave 3 owns this file) — no wait, cross-file
touch. Add a NEW file `apps/worker/src/sequence/inbound-handler.ts`:
```ts
export async function handleInboundReply(inbound: InboundEmail, enrollmentId: string): Promise<void>
export async function handleInboundBounce(inbound: InboundEmail, enrollmentId: string): Promise<void>
```
Called from the poller. Loads enrollment, calls
`transition(snapshot, { kind: "reply_received"|"bounce_received", ... })`,
interprets effects (terminate + emit_event → wraps in `logger.info` + PostHog
`capture`).

### T4 — Server fns (`apps/web/src/lib/inbox.functions.ts`)
- `listInboxThreads({ filter, cursor, limit })` — grouped by thread. Filters:
  unread, replied, bounced, by sequence, by mailbox.
- `getInboxThread({ threadKey })` — full ordered messages. Marks as read.
- `sendReply({ threadKey, bodyHtml, bodyText? })` — sends via the same mailbox
  as the anchor, threaded properly (`In-Reply-To`/`References` populated,
  `providerThreadId` passed).
- `manuallyStopEnrollment({ enrollmentId, reason })` — writes stop event.
- `suppressEmail({ email, reason? })` + `unsuppressEmail({ email })`.
- `listSuppressions({ search?, cursor? })`.

### T5 — Inbox UI (`apps/web/src/routes/_protected/inbox/`)
- `index.tsx` — split-pane: left threads list (react-virtualization for perf),
  right thread detail. Filters as toggle chips. Sort by newest inbound.
- Thread detail: outbound + inbound messages in order, with sender/recipient/
  time/status badges. Reply composer at bottom (same mailbox pre-selected;
  read-only for display).
- Toolbar: mark all read, filter unread, quick-suppress-email action per
  message.
- Settings link → `/settings/suppression` showing suppression list with search
  + bulk actions.

### T6 — Verification (STRICT)
```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase7_inbox
pnpm db:migrate
pnpm check   # green
```

Manual smoke:
- Send a real email from the compose UI to a real inbox you control.
- Reply to it from the destination inbox.
- Wait ~2 min (poll interval), or manually enqueue `mailbox.poll` for that
  mailbox.
- Confirm the reply appears in the Inbox UI, threaded under the outbound.
- If the send was part of an active enrollment, confirm the enrollment
  transitions to `replied`.
- Send to an unroutable address, confirm the bounce shows up + address is
  suppressed.

## Constraints
- **Touch ONLY**:
  - `packages/db/src/schema/suppression.ts` (new)
  - `packages/db/src/schema/index.ts` (one export line)
  - `packages/db/src/tenancy-guard.test.ts` + `packages/db/src/testing.ts`
  - `apps/worker/src/handlers/mailbox-poll.ts` (new)
  - `apps/worker/src/sequence/inbound-handler.ts` (new)
  - `apps/worker/src/index.ts` (add registerHandler + scheduler call)
  - `apps/web/src/lib/inbox.functions.ts` (new)
  - `apps/web/src/routes/_protected/inbox/**` (new)
  - `apps/web/src/routes/_protected/settings/suppression.tsx` (new)
- **DO NOT** modify `packages/mail/src/{bounce,inbound-matching,threading}.ts` —
  Phase 7-prep owns them
- **DO NOT** modify existing sequence/executor files
- Context7 MCP for imapflow/imap-simple, mailparser, Gmail history API, Graph
  delta API

## Result
```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/suppression.ts", "..."],
  "notes": "Phase 7 complete. pnpm check green. Poller runs every 2min per mailbox; Gmail history + Graph delta + IMAP cursors handled. Inbound reply on active enrollment transitions to 'replied'; hard bounce adds suppression + terminates. Auto-reply detection configurable per workspace."
}
```
