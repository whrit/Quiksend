# PHASE-4-REMAINDER: Gmail + Microsoft Graph adapters + full DKIM check — Track F

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-4-gmail-graph` from `main` (worktree isolated).

## Context

Read at repo root first:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (root) + `wave2/WAVE_CONTEXT.md`
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md`
   section "Phase 4 — Mailboxes & single send" — the parts NOT covered by Phase
   4 back-half (Wave 1)
4. `packages/mail/src/adapters/smtp.ts` (Wave 1 landed this — read for the
   pattern; do NOT modify)
5. `packages/integrations/src/nango.ts` — the Nango client wrapper you use for
   mailbox OAuth

Wave-1 landed the SMTP adapter + `mailbox` schema + compose UI. Wave 2 fills in
the two OAuth-based providers so real users can connect Gmail + Microsoft
accounts.

## Documentation lookup (mandatory)

Context7 MCP for:

- **@nangohq/node** — `nango.proxy()` and `nango.get()` for making authenticated
  provider calls with token refresh managed by Nango
- **Gmail API v1** — `users.messages.send` (raw base64url MIME), `users.messages.list`,
  `users.history.list` (Phase-7 prep), correct scopes for send + read
- **Microsoft Graph** — `/me/sendMail` (raw MIME via `internetMessageHeaders`),
  `/me/messages`, `/me/mailFolders/inbox/messages/delta` (Phase-7 prep)
- **Node `dns/promises`** — `resolveTxt` behavior for TXT record parsing
- **@nangohq/frontend** — `openConnectUI({ onEvent })` + `setSessionToken` for
  Gmail + Microsoft mailbox connect

## Tasks

### T1 — Gmail adapter (`packages/mail/src/adapters/gmail.ts`)

Implement `MailboxAdapter` for `provider: "gmail"`. Constructor:

```ts
export function createGmailAdapter(config: {
  nangoConnectionId: string;
  fromAddress: string;
  fromName?: string;
}): MailboxAdapter;
```

- `send(input)` — build MIME via `buildMime()` from `@quiksend/mail` (Wave 1 landed
  it). Base64url-encode the raw MIME. Call
  `nango.post({ endpoint: "/gmail/v1/users/me/messages/send", providerConfigKey:
"google-mail", connectionId, data: { raw: <b64url>, threadId? } })`.
  Return `SendResult`:
  - `messageId` — the RFC Message-Id header VALUE, normalized via
    `normalizeMessageId`. Gmail responds with `id` + `threadId` but NOT the
    RFC Message-Id — fetch it via `/gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=Message-Id`.
  - `providerMessageId` = the Gmail `id`
  - `providerThreadId` = the Gmail `threadId`
  - `sentAt` = now
    When `anchor.providerThreadId` is set, include `threadId` in the send call so
    Gmail correctly threads it — this is IN ADDITION to the RFC headers (both
    matter for cross-client threading).
- `listInbound(since)` — Phase 7 prep, but stub cleanly here. Return
  `[]` and note "history-based polling wired in Phase 7 R-070". Do NOT throw —
  keeping the return path clean means the engine can call it uniformly today
  and it just returns nothing.
- `verifyIdentity()` — DNS-based check via the helper you extend in T3.

Error classification:

- 401/403 from Gmail → `SendError("auth")`
- 429 or `RATE_LIMIT_EXCEEDED` → `"quota"`
- 5xx → `"transient"`
- 400 with invalid recipient → `"permanent"`

Unit tests in `packages/mail/src/adapters/gmail.test.ts` — mock the Nango client
via a wrapper (dependency-inject). Cover:

- Happy path: build MIME → base64url → POST → Message-Id fetched.
- Threading: `anchor.providerThreadId` → `threadId` in payload.
- Error mapping across the four kinds above.

### T2 — Microsoft Graph adapter (`packages/mail/src/adapters/microsoft.ts`)

Analogous. Constructor:

```ts
export function createMicrosoftAdapter(config: {
  nangoConnectionId: string;
  fromAddress: string;
  fromName?: string;
}): MailboxAdapter;
```

- `send(input)` — Graph accepts raw MIME via `POST /me/sendMail` with
  `Content-Type: text/plain` and body = base64-encoded MIME. Prefer this over
  structured payloads to keep the code path uniform.
  Fetch the resulting Message-Id via `GET /me/messages/{id}?$select=internetMessageId`.
  `providerThreadId` = Graph's `conversationId`.
- `listInbound(since)` — stub returning [] with the same Phase-7 note.
- `verifyIdentity()` — DNS check.

Error classification:

- 401/`InvalidAuthenticationToken` → `"auth"`
- 429 or `TooManyRequests` → `"quota"`
- 5xx → `"transient"`
- 400 or 422 with recipient errors → `"permanent"`

Unit tests analogous to gmail.

### T3 — Full DNS auth checker (`packages/mail/src/dns.ts` — extend)

Wave 1 shipped a partial `checkDomainAuth`. Extend to:

- **SPF** — resolveTxt, find `v=spf1`, note if `-all` (strict) vs `~all`
  (soft-fail) vs `?all` (neutral). Return `{ pass, reason, record, mode }`.
- **DKIM** — try selectors: `default._domainkey.<domain>`, `google._domainkey.<domain>`
  (for Google Workspace), `k1._domainkey.<domain>` (SendGrid-ish),
  `selector1._domainkey.<domain>` + `selector2._domainkey.<domain>` (Microsoft 365).
  Parse the returned TXT for `v=DKIM1; p=<key>`. Return
  `{ pass, reason, record, selectors_found: string[] }`.
- **DMARC** — resolveTxt `_dmarc.<domain>`; parse for `v=DMARC1; p=<policy>`.
  Return `{ pass, reason, record, policy: 'none' | 'quarantine' | 'reject' | null }`.

Unit tests in `packages/mail/src/dns.test.ts` — mock `dns/promises`; cover:

- All three pass
- Each individually failing
- Multiple DKIM selectors — first-found wins with correct field
- DMARC without a policy value

### T4 — Adapter registry (`packages/mail/src/adapters/index.ts`)

Extend the barrel to export the new adapters. Add a factory function:

```ts
export function createAdapterForMailbox(mailbox: {
  provider: MailProvider;
  nangoConnectionId: string | null;
  smtpConfig: SmtpConfig | null;
  address: string;
  fromName: string | null;
}): MailboxAdapter;
```

Switches on provider → the right factory. Throws a clear error if OAuth
credentials are missing for gmail/microsoft (NANGO_SECRET_KEY unset).

### T5 — Mailbox connect UI update

Extend `apps/web/src/routes/_protected/settings/mailboxes/new.tsx` (Wave 1
scaffolded the SMTP form + placeholder Gmail/Microsoft buttons):

- Wire the Gmail button to call a new server fn `createGmailConnectSession()`
  which uses `nango.createConnectSession({ end_user: {...}, allowed_integrations: ["google-mail"] })`.
- Frontend opens Nango's Connect UI via `@nangohq/frontend`.
- On success: `finalizeGmailMailbox({ nangoConnectionId, address })` inserts a
  `mailbox` row with `provider='gmail'`. Fires a health check.
- Same for Microsoft with `allowed_integrations: ["microsoft"]`.

Add these server fns to `apps/web/src/lib/mailboxes.functions.ts` (Wave 1 exists,
you EXTEND it — additive only).

### T6 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm check     # green
```

Manual smoke:

- With `NANGO_SECRET_KEY` set (Beckett provides), connect a real Gmail dev
  account through the settings page.
- Send a test message. Confirm it lands in the destination inbox with correct
  From/Subject/List-Unsubscribe.
- Verify the returned Message-Id is captured normalized in the DB `message` row.
- Repeat for Microsoft account.
- Health check: mailbox on a properly-configured domain shows all three green.

If NANGO_SECRET_KEY isn't available, write RESULT.notes explaining "adapter
implementation + unit tests complete; live smoke deferred, no sandbox creds."

## Constraints

- **Touch ONLY**:
  - `packages/mail/src/adapters/gmail.ts` (new)
  - `packages/mail/src/adapters/microsoft.ts` (new)
  - `packages/mail/src/adapters/index.ts` (extend)
  - `packages/mail/src/adapters/{gmail,microsoft}.test.ts` (new)
  - `packages/mail/src/dns.ts` (extend)
  - `packages/mail/src/dns.test.ts` (extend/new)
  - `apps/web/src/lib/mailboxes.functions.ts` (extend — additive only)
  - `apps/web/src/routes/_protected/settings/mailboxes/new.tsx` (extend)
- **DO NOT** modify `packages/mail/src/adapters/smtp.ts` (Wave 1 owns it),
  `packages/mail/src/{adapter,mime,threading,compliance}.ts` (foundations).
- **DO NOT** touch schemas — Phase 4 back-half already added `mailbox`/`message`.
- Context7 MCP for Gmail, Graph, Nango, dns/promises.

## Result

```json
{
  "status": "ok",
  "files": ["packages/mail/src/adapters/gmail.ts", "..."],
  "notes": "Phase 4 remainder complete. pnpm check green. Gmail + Microsoft Graph adapters implement MailboxAdapter with Nango-managed OAuth. RFC Message-Id fetched from send response, provider thread ids captured. DNS checker validates SPF (with mode), DKIM (multi-selector), DMARC (with policy). Live smoke: <describe or defer>."
}
```
