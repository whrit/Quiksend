# PHASE-4: Mailboxes + Single Send (SMTP-first) — Track B

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-4-mail-smtp` from `main` (worktree, isolated).

## Context

Read at repo root first:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (critical — `message` table designed for inbound from day one)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` section
   "Phase 4 — Mailboxes & single send"
4. `packages/mail/src/{adapter,threading,compliance,mime}.ts` — the interface,
   MIME builder, threading, and List-Unsubscribe were built in foundations
   (v1.1.0). You implement the FIRST concrete adapter (SMTP via nodemailer against
   Mailpit) + schemas + UI. Gmail + Microsoft Graph adapters land in Wave 2 —
   NOT in this brief.

Local infra is running: Postgres on `:5432`, Mailpit on `:1025` (SMTP) and
`:8025` (UI). See `docker-compose.yml`.

## Documentation lookup (mandatory)

Fetch via Context7 MCP before writing:

- **nodemailer** — `createTransport({host, port, ...})`, `sendMail({from, to, subject,
html, text, headers, messageId, references, inReplyTo})`, the `SentMessageInfo`
  return shape (envelope, messageId, response, accepted, rejected)
- **Drizzle ORM** — schema + migrations + partial indexes + jsonb defaults
- **TanStack Start** — `createServerFn`, file-based route conventions
- **@radix-ui/react-dialog** (for compose modal) — already installed
- **Node `dns/promises`** — `resolveTxt`, `resolveMx` for the DKIM/SPF/DMARC
  checker

## Tasks (in order)

### T1 — Schema (`packages/db/src/schema/mail.ts`)

- **`mailbox`** — id (uuid pk), organization_id (text FK cascade),
  owner_user_id (text FK → user.id),
  provider pg enum ('gmail', 'microsoft', 'smtp') notNull,
  address (text notNull, lowercased),
  display_name (text nullable), from_name (text nullable),
  nango_connection_id (text nullable — for gmail/microsoft in Wave 2),
  smtp_config (jsonb nullable — encrypted; for provider='smtp'),
  daily_cap (int default 50 notNull),
  send_window (jsonb notNull, default `{"timezone":"UTC","window":{"mon":[[9,17]],"tue":[[9,17]],"wed":[[9,17]],"thu":[[9,17]],"fri":[[9,17]]}}`),
  throttle_seconds (int default 90 notNull),
  signature_html (text nullable),
  spf_ok (boolean nullable), dkim_ok (boolean nullable), dmarc_ok (boolean nullable),
  health_checked_at (timestamptz nullable), health_notes (jsonb nullable),
  status text default 'active' ('active' | 'paused' | 'error'),
  timestamps.
  Unique `(organization_id, address, provider)`.

- **`message`** — id (uuid pk), organization_id (text FK cascade),
  mailbox_id (uuid FK → mailbox.id cascade),
  prospect_id (uuid FK → prospect.id set null — Track 2's table),
  enrollment_id (uuid nullable — Phase 5+),
  direction pg enum ('outbound', 'inbound') default 'outbound' notNull,
  subject (text nullable), body_html (text nullable), body_text (text nullable),
  message_id_header (text nullable — the RFC-822 Message-Id VALUE, normalized
  via `normalizeMessageId` from `packages/mail/threading.ts`),
  provider_message_id (text nullable), provider_thread_id (text nullable),
  in_reply_to (text nullable), references_header (text nullable),
  status text default 'sent' ('sent' | 'failed' | 'bounced' | 'received'),
  bounce_type text nullable ('hard' | 'soft'),
  dsn (jsonb nullable),
  sent_at (timestamptz nullable), received_at (timestamptz nullable),
  error (text nullable),
  timestamps.
  Indexes:
  - `(organization_id, mailbox_id, direction, sent_at DESC)` — mailbox list view
  - `(message_id_header)` — Phase-7 thread matching
  - `(provider_thread_id)` — Gmail/Graph thread lookup
  - `(organization_id, prospect_id)` — prospect timeline

Barrel export from `packages/db/src/schema/index.ts`:

```ts
export * from "./mail.ts";
```

### T2 — Activate tenancy guard

Add `mailbox`, `message` to `APP_SCOPED_TABLES` (tenancy-guard.test.ts).
Add to `APP_SCOPED_TABLES_TO_TRUNCATE` (testing.ts) — order matters:
`message` before `mailbox` before `prospect` (Track 2 will list this too).

### T3 — Migration

`pnpm db:generate --name phase4_mailbox_message` → review → `pnpm db:migrate`.

### T4 — SMTP adapter (`packages/mail/src/adapters/smtp.ts`)

Implement `MailboxAdapter` for the `smtp` provider using nodemailer. Take
config from the DB row's `smtp_config` field (assume already decrypted — see T5).

```ts
export function createSmtpAdapter(config: {
  host: string;
  port: number;
  auth?: { user: string; pass: string };
  secure?: boolean;
  fromAddress: string;
  fromName?: string;
}): MailboxAdapter;
```

- `send(input)` — build MIME via `buildMime()` from `@quiksend/mail`, hand raw MIME
  to nodemailer via `transport.sendMail({ raw: mime.raw })` OR construct a
  standard nodemailer payload (whichever the current API cleanly supports —
  check via Context7). Return `SendResult` with `messageId` (normalized via
  `normalizeMessageId`), `providerMessageId` (from nodemailer's `.messageId`),
  `providerThreadId: null` (SMTP has no thread id), `sentAt: new Date()`.
  Classify errors: `EAUTH` → `SendError("auth", ...)`; `ECONNREFUSED`/`ETIMEDOUT`/5xx →
  `"transient"`; 5xx invalid recipient → `"permanent"`.
- `listInbound(since)` — throw a clear "not implemented for SMTP-out-only adapter;
  IMAP polling lands in Phase 7" error. Wave 2 wires an IMAP variant.
- `verifyIdentity()` — resolve SPF (`resolveTxt(domain)` looking for `v=spf1`),
  DKIM (naive: check that `default._domainkey.<domain>` resolves to something —
  full DKIM verification is a Phase-4 R-044 concern; you may partial-implement
  and note remaining work). DMARC: `resolveTxt('_dmarc.' + domain)` looking for
  `v=DMARC1`.

Register the SMTP adapter in `packages/mail/src/adapters/index.ts` (extend the
barrel).

Unit-test in `packages/mail/src/adapters/smtp.test.ts`:

- Mock nodemailer `createTransport` (Vitest module mock) — assert `sendMail` is
  called with correctly-built MIME.
- Verify threading headers pass through when `anchor` is provided (build via
  `buildMime` under the hood).
- Verify error classification: EAUTH → SendError.kind === 'auth', etc.

### T5 — SMTP credential encryption (`packages/mail/src/crypto.ts`)

`MAILBOX_ENCRYPTION_KEY` (base64 32-byte) already declared in env. Implement:

- `encryptSmtpConfig(plain, keyBase64) → base64String` — AES-256-GCM,
  random nonce, output = `nonce || tag || ciphertext` (base64-encoded).
- `decryptSmtpConfig(cipher, keyBase64) → plain`.
- Both use Node `crypto` (already available).

Unit-test round-trip in `packages/mail/src/crypto.test.ts`. Include a test that a
tampered ciphertext fails auth-tag verification.

### T6 — DNS auth checker (`packages/mail/src/dns.ts`)

Wraps Node's `dns/promises`. Exports:

```ts
export async function checkDomainAuth(domain: string): Promise<{
  spf: { pass: boolean; reason: string | null; record: string | null };
  dkim: { pass: boolean; reason: string | null };
  dmarc: { pass: boolean; reason: string | null; record: string | null };
}>;
```

- SPF: `dns.resolveTxt(domain)`; scan for `v=spf1`; pass=true if a permissive
  clause exists.
- DKIM: check `default._domainkey.<domain>` resolves; if not, try common
  selectors (`google`, `k1`, `s1`). Note: full DKIM key validation is out of scope.
- DMARC: `dns.resolveTxt('_dmarc.' + domain)`; pass=true if `v=DMARC1`.

Unit-test with `dns/promises` mocked — happy path + all three failing.

### T7 — Server fns (`apps/web/src/lib/mailboxes.functions.ts`)

Every fn `orgFn`-guarded. Admin gate via `isAdminOrOwner`.

- `listMailboxes()` — org-scoped, ordered by created_at desc.
- `getMailbox({ id })` — 404 outside caller's org.
- `createSmtpMailbox({ address, fromName?, host, port, secure?, auth?,
dailyCap?, throttleSeconds?, sendWindow?, signatureHtml? })` — admin gate.
  Encrypts `smtp_config` with `MAILBOX_ENCRYPTION_KEY`.
- `updateMailbox({ id, patch })` — admin gate; patch is a narrow Zod object.
- `deleteMailbox({ id })` — admin gate; cascade drops messages.
- `checkMailboxHealth({ id })` — runs `checkDomainAuth(addressDomain)` +
  updates the `spf_ok`/`dkim_ok`/`dmarc_ok`/`health_checked_at`/`health_notes`
  columns. Returns fresh values.
- `testMailboxSend({ id, toEmail })` — sends a plain "Quiksend test" message via
  the adapter; useful for the connect UI. NOT gated to admin (any member can
  smoke-test their own mailbox).

### T8 — Compose + single send (`apps/web/src/lib/compose.functions.ts`)

- `sendComposedMessage({ mailboxId, prospectId, subject, bodyHtml, bodyText?,
anchor? })` — org-scoped:
  1. Load mailbox + prospect (both in caller's org).
  2. Resolve compliance data:
     - Sender org name = the `organization.name`
     - Sender postal address — read from an env-derived or org-settings field.
       For Wave-1, hard-code from the `organization.metadata` jsonb (add
       `postal_address` there — you MAY add a small edit UI, or accept "1 Main St,
       City" as a placeholder and note it).
     - unsubscribeUrl — for Wave 1, mint a placeholder (`https://app.example.com/u/pending`)
       and note that the actual signed one-click token wires in Phase 10.
  3. `buildMime()` + `adapter.send()`.
  4. Persist `message` row: capture the RFC Message-Id from `SendResult` (normalize),
     set `direction='outbound'`, `status='sent'`, populate threading columns.
  5. Return `{ messageId, providerMessageId, sentAt }`.

### T9 — Web routes

- `apps/web/src/routes/_protected/settings/mailboxes/index.tsx` — table of
  mailboxes with columns: address, provider, from name, daily cap, throttle,
  health (three little dots: SPF/DKIM/DMARC each green/red), status, actions
  (test-send, refresh health, delete). "Add mailbox" button opens a dialog.
- `apps/web/src/routes/_protected/settings/mailboxes/new.tsx` — form to add
  an SMTP mailbox. Wire Gmail/Microsoft options as "disabled — coming in Wave 2"
  buttons. React-hook-form + Zod + shadcn `Form`.
- `apps/web/src/routes/_protected/compose.tsx` — new-route compose page:
  - Mailbox dropdown (Select), prospect picker (typeahead — search prospects
    server-fn from Track 2), subject input, body editor (start with a
    `<Textarea>` — rich editor is Phase 8).
  - "Send" button calls `sendComposedMessage`.
  - After send, show a toast with the RFC Message-Id and a link "Start a
    follow-up sequence from this message" (link stub — routes to
    `/sequences/new?anchorMessageId=…` which will exist in Phase 5).

### T10 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase4_mailbox_message
pnpm db:migrate
pnpm check     # MUST be green
```

Local Mailpit smoke:

- With docker compose up, sign in, create an SMTP mailbox pointed at Mailpit
  (host=localhost, port=1025, no auth).
- From compose page, send yourself a test email to any address.
- Open http://localhost:8025 in a browser and confirm the message shows up
  with the RFC Message-Id + List-Unsubscribe headers.
- Confirm the DB `message` row was persisted with `message_id_header`
  populated (normalized, angle brackets, lowercased).

Note any issue in RESULT.notes.

## Constraints

- **Touch ONLY** files under "Track 4 owns" in WAVE_CONTEXT.md plus:
  - `packages/db/src/schema/index.ts` (one export line)
  - `packages/db/src/tenancy-guard.test.ts` (add table names)
  - `packages/db/src/testing.ts` (add table names)
  - `packages/mail/src/adapters/index.ts` (add smtp export)
  - `packages/mail/package.json` ONLY if you need a new dep — nodemailer is
    already installed
  - `apps/web/src/routes/routeTree.gen.ts` (auto)
- **DO NOT** touch `packages/db/src/schema/{prospects,crm}.ts` (Tracks 2 & 3)
- **DO NOT** touch Gmail/Microsoft adapter files. Placeholder stubs already
  exist in `packages/mail/src/adapters/index.ts` comment — you may add real
  files in Wave 2, not Wave 1.
- Context7 MCP for nodemailer, dns/promises usage patterns, Drizzle jsonb
  defaults.

## Result

```json
{
  "status": "ok",
  "files": ["packages/db/src/schema/mail.ts", "..."],
  "notes": "Phase 4 back-half complete. pnpm check green. SMTP → Mailpit send verified: RFC Message-Id captured (see notes), List-Unsubscribe + physical-address footer present in Mailpit rendering. DKIM check partial (identity resolves but full key validation deferred to R-044 remainder in Wave 2). Encryption round-trip tests pass."
}
```
