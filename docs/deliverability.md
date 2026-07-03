# Enterprise deliverability

Sending cold email to enterprise recipients in 2026 fails silently far more often than
it bounces. 25–45% of enterprise inboxes sit behind a **Secure Email Gateway (SEG)** —
Proofpoint, Mimecast, Barracuda, Cisco Secure Email — that filters inbound mail
before it hits the actual mailbox. Sends from consumer ESPs (Gmail, Google Workspace)
to SEG-protected domains are frequently dropped with `250 OK` at the SMTP layer, so
the sender sees "delivered" but the message never reaches the inbox.

Quiksend's deliverability stack detects SEG-protected recipients, routes around them
when possible, and canary-tests real-time delivery to catch silent drops.

## What Quiksend does

1. **Detection** — classify every prospect's mail gateway from MX / SPF / DMARC.
2. **Routing** — send SEG-destined mail from mailboxes you mark as
   `enterprise_safe` (aged Microsoft 365 or dedicated-IP relay), not from Gmail.
3. **Canary deliverability** — inject test sends into every campaign, poll seed inboxes
   for arrival, auto-pause campaigns that drop below threshold.

Each layer is opt-in and inspectable in the UI.

## Phase 11A — Detection & segmentation

Available on every workspace by default. No configuration required.

### How classification works

When a prospect is created (manual, CSV import, CRM sync, public API):

1. `apps/worker/src/handlers/gateway-detect.ts` enqueues `gateway.detect_single` (or
   `gateway.detect_bulk` for imports).
2. The handler consults `gateway_classification` — a shared domain-level cache
   across all workspaces (MX records are public, so caching per-domain is safe and
   saves redundant DNS lookups).
3. Cache miss → run the detection cascade in `packages/mail/src/gateway-detect.ts`:
   - `resolveMx(domain)` → match against `packages/mail/src/gateway-fingerprints.json`
     (20+ patterns covering Proofpoint, Mimecast, Barracuda, Cisco, Trend Micro,
     Fortinet, Sophos, Symantec, Google Workspace, Microsoft 365, Zoho, Fastmail)
   - If ambiguous, inspect DMARC record `rua=` for known SEG report addresses
   - If still ambiguous, inspect SPF `include:` directives
   - Otherwise: `unknown`
4. Result cached with TTL (30 days for high confidence, 7 days for low)
5. `prospect.email_gateway` populated on all prospects at that domain

### What you see in the UI

- **Prospect card / list**: gateway badge next to the email address (Proofpoint red,
  Mimecast orange, Microsoft 365 blue, Google Workspace green, Unknown gray)
- **Prospect list filter chip**: multi-select gateway filter
- **List detail**: horizontal SEG-mix bar chart
- **Workspace overview** (`/`): "Prospect gateway mix" card with % classified counter
- **Sequence detail**: "Deliverability outlook" panel + gateway mix chart

### Sequence step entry conditions

Sequence step editor (`_protected/sequences/$id/edit.tsx`) now exposes two extra
entry-condition predicates alongside the existing `if_no_reply`:

- **Only send if recipient is behind:** `recipientGatewayIn: EmailGateway[]`
- **Never send if recipient is behind:** `recipientGatewayNotIn: EmailGateway[]`

Evaluated in `packages/core/src/state-machine/entry-conditions.ts` — pure logic,
same as every other entry condition. State machine emits `skipReason` when a step is
skipped for a gateway mismatch.

### The Google-Workspace-behind-Proofpoint case

Enterprise pattern: **inbound routes through Proofpoint, storage is Google Workspace**.
MX points to Proofpoint, but the actual mailbox is Google-hosted. Quiksend classifies
this as `proofpoint` — because Proofpoint is what filters us. The tooltip on the
badge explains "Inbound routed through Proofpoint → storage on Google Workspace".

## Phase 11B — Routing

Off by default. Enable in **Settings → Deliverability**.

### The `enterprise_safe` flag

Every mailbox gets a boolean `enterprise_safe`. Set it in **Settings → Mailboxes**.
Guidance:

| Mailbox                                                                      | Enterprise-safe?                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Gmail (personal)                                                             | ❌ Never                                         |
| Google Workspace (any age)                                                   | ⚠️ Risky — Proofpoint downgrades Google outbound |
| Microsoft 365 (< 3 months)                                                   | ⚠️ Not warmed enough                             |
| Microsoft 365 (6+ months, organic traffic)                                   | ✅ Yes — M365→Proofpoint has trust bonus         |
| Dedicated IP transactional relay (Postmark / SES / Mailgun, warmed 30+ days) | ✅ Yes                                           |
| SMTP via your own MTA (warmed, DKIM aligned, DMARC `p=quarantine`+)          | ✅ Yes                                           |

If you toggle a mailbox to `enterprise_safe` but Phase 11C's canary detector sees
its actual delivery drop, `enterprise_safe_auto_downgraded` gets set — the mailbox
becomes ineligible for SEG routing until you investigate and clear the flag.

### Workspace routing policy

**Settings → Deliverability** — three modes:

- **Off** (default) — engine sends regardless of gateway/mailbox mix. Warning
  banners still show in sequence detail when there's a risky mix.
- **Warn** — engine still sends, but emits an `event` per skip-worthy send and adds
  a red banner on the sequence page.
- **Enforce** — engine actually skips SEG-destined sends when no safe mailbox is
  available. Enrollment moves to `paused` with reason
  `enrollment.no_safe_mailbox_for_gateway`.

### The auto-swap exception

If an enrollment has a captured anchor (`anchor_message_id IS NOT NULL`), Quiksend
does **not** auto-swap mailboxes for the follow-up — threading integrity beats
routing optimization once a real conversation exists. In that case, the router
keeps the current mailbox and emits an `at_risk` event you can subscribe to via
webhooks.

### Content sanitizer

Available under the same **Settings → Deliverability** panel. When enabled, sends
destined for SEG-classified recipients are:

- Stripped of tracking pixel (`<img>` matching Quiksend's tracking domain)
- Stripped of external images (or inlined as base64 when < 100 KB)
- Preferred plain-text (`multipart/alternative` with text/plain first, HTML part
  dropped when text-only is complete)

### SEG throttle and per-domain gap

Two additional throttle rules apply to SEG-destined sends:

- Per-mailbox daily cap gets a hard sub-cap for SEG destinations. Default 50 per
  mailbox per day. Override with env `SEG_DAILY_CAP_PER_MAILBOX`.
- Minimum **5-minute gap** between two sends from the same mailbox to the same
  recipient domain. Violation → send deferred via `schedule_at`, not rejected.

Both enforced inside the advisory lock in `apps/worker/src/sequence/reserve-slot.ts`.

## Phase 11C — Canary deliverability

Off by default. Two tiers:

### Free — user-provided seed inboxes

You register IMAP-accessible mailboxes you own or can reach. Configure at
**Settings → Deliverability → Seed inboxes**. Options for finding your own seeds:

- A friend at Acme (whose mail is Proofpoint-filtered) shares an inbox with you
- Pay ~$5/mo for a hosted mailbox behind a specific SEG (some testing services offer this)
- Your own internal IT test mailbox behind your company's SEG

For each seed, provide:

- Email address
- IMAP host, port, username, password
- Gateway (declared, not auto-detected)
- Optional notes

### Paid — Deliverability Pro (provider-managed pool)

Quiksend operates a pool of ~12 seed inboxes covering the four major SEGs
(Proofpoint / Mimecast / Barracuda / Cisco Secure Email). Pro subscribers get
automatic canary coverage across all four without needing to source their own
seeds. See the internal runbook at `internal-runbooks/seed-pool-setup.md` for the
operational side (public repo notes only).

Entitlement is gated on `organization.metadata.entitlements.deliverability_pro.activeUntil`
(billing integration is separate; check with your workspace admin).

Self-hosters get user-provided seeds only. The `SYSTEM_SEED_ENCRYPTION_KEY` env
var — required to decrypt provider-managed seed credentials — is not deployed to
self-host environments.

### How canaries work

1. When you enroll prospects, `enrollProspects()` computes the SEG mix
2. For each SEG with ≥ 5 prospects (workspace-configurable), pick N seed inboxes
   for that SEG (default 3), inject M canary sends at random positions in the
   campaign
3. Each canary is a real send from your mailbox — same body as an adjacent real
   send, with placeholder identity values, and one extra header:
   `X-Quiksend-Canary-Id: <uuid>`
4. Every 5 minutes, `apps/worker/src/handlers/canary-check.ts` polls seed inboxes
   via IMAP, searches for canaries by header, classifies arrival:
   - `arrived_inbox` — landed in Inbox
   - `arrived_spam` — landed in Spam / Junk
   - `arrived_quarantine` — landed in SEG quarantine
   - `silent_drop` — not found after 24 hours
   - `bounced` — DSN received
5. `packages/core/src/deliverability/auto-pause.ts` evaluates rolling 2-hour
   delivery rate per `(sequence, mailbox, gateway)` tuple. If < 80% (configurable)
   with ≥ 3 canaries of signal, the sequence auto-pauses.

### The deliverability grid

**Deliverability → Grid** — live view:

- **Rows** = your mailboxes
- **Columns** = SEGs represented in your workspace
- **Cells** = arrival % over the selected window (7 / 14 / 30 days), plus sparkline
  - Green: ≥ 90%
  - Yellow: 50–90%
  - Red: < 50%
  - Gray: insufficient data (< 3 canaries in window)

Click a cell → drawer with canary history, evidence headers (`Authentication-Results`,
`Received` chain from arrived messages), last drop time and details.

Refreshes every 30 seconds via polling.

### Auto-pause alerts

When a sequence auto-pauses because canary threshold breached:

- **In-app**: toast + persistent banner on the sequence page
- **Email**: sent to workspace admins with:
  > Your campaign "Q3 Enterprise Outbound" has been auto-paused.
  > Reason: deliverability to Proofpoint dropped to 43% (threshold: 80%).
  > Details: 8 canary sends in the last 2 hours, 3 arrived inbox, 5 silently dropped.

Auto-paused campaigns do NOT auto-resume when deliverability recovers — user
confirmation required (avoids flapping).

## Webhooks for deliverability events

The following event types are emitted and can be subscribed to via
**Settings → Webhooks** (see [webhooks.md](./webhooks.md) for HMAC verification):

| Event                                    | When it fires                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `enrollment.no_safe_mailbox_for_gateway` | Routing policy `enforce` skipped a SEG-destined send                                  |
| `enrollment.paused`                      | Includes canary-triggered auto-pauses (check payload for `reason`)                    |
| `deliverability.canary.silent_drop`      | A canary was sent > 24h ago and never arrived                                         |
| `deliverability.canary.arrived`          | A canary arrived (either inbox / spam / quarantine) — useful for real-time monitoring |
| `gateway.detected`                       | A prospect's gateway classification changed (initial or reclassification)             |

## Where to look in the code

| Layer              | Files                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Detection          | `packages/mail/src/gateway-detect.ts`, `packages/mail/src/gateway-fingerprints.json`, `apps/worker/src/handlers/gateway-detect.ts` |
| Cache table        | `packages/db/src/schema/deliverability.ts` — `gatewayClassification`                                                               |
| Entry conditions   | `packages/core/src/state-machine/entry-conditions.ts`                                                                              |
| Routing            | `apps/worker/src/sequence/mailbox-router.ts`, `packages/core/src/deliverability/mailbox-safety.ts`                                 |
| Sanitizer          | `packages/mail/src/content-sanitizer.ts`                                                                                           |
| Throttle           | `apps/worker/src/sequence/reserve-slot.ts`                                                                                         |
| Canary injection   | `apps/web/src/lib/canary-injection.ts`, hooked from `sequences.functions.ts` `enrollProspects`                                     |
| Canary polling     | `apps/worker/src/handlers/canary-check.ts`                                                                                         |
| Auto-pause         | `packages/core/src/deliverability/auto-pause.ts`                                                                                   |
| Grid + settings UI | `apps/web/src/routes/_protected/deliverability/`, `apps/web/src/routes/_protected/settings/deliverability.tsx`                     |

## Related runbooks

- Canary appears stuck / not arriving: [troubleshooting.md#canary-stuck-or-not-arriving](./troubleshooting.md#canary-stuck-or-not-arriving)
- Prospect gateway shows `unknown` unexpectedly: [troubleshooting.md#gateway-classification-stale-or-unknown](./troubleshooting.md#gateway-classification-stale-or-unknown)
- Sequence auto-paused by canary: [troubleshooting.md#sequence-auto-paused-by-canary](./troubleshooting.md#sequence-auto-paused-by-canary)

## Full design spec

The full implementation plan (schema, mechanics, provider pool operations, cost
model) lives at
[`docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`](./implementations/phases/Quiksend-Implementation-Plan-Phase-11.md).
