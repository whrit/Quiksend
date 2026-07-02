# Quiksend — Implementation Plan, Phase 11: Enterprise Deliverability

Companion to `Quiksend-Implementation-Plan-Phases-2-10.md` and `design_implementation_v1.md`.
This document specs **Phase 11 — Enterprise Deliverability**, the response to the
Secure Email Gateway (SEG) problem: 25–45% of enterprise recipients sit behind
Barracuda / Mimecast / Proofpoint / Cisco / others, and Gmail-origin sends to those
recipients are silently dropped without a bounce. Standard bounce monitoring misses
this failure mode entirely, so users burn campaigns into blackholes without knowing.

**Status this builds on:** Phases 0–10 are shipped and released as `v2.0.0`; Waves 5

- 6 hardened the engine and closed the review report (`v2.1.1` on main). The engine
  is I/O-safe, adapters are properly decoupled, the state machine has `entry-conditions`
  (Wave 5 BETA), a shared web + worker effect executor (`applyWebEffects` from Wave 6
  OMEGA), and per-mailbox throttle/reservation in `reserve-slot.ts` (Wave 5 ALPHA).
  Every Phase-11 module attaches to one of those extension points.

**How to read this.** Same shape as prior phases: Goal → Builds on → Data model →
Server surface → UI → Mechanics → Tickets → Testing → Risks → Exit. The genuinely
novel parts are the **detection cascade** (§ 11A Mechanics), the **routing
guard-rails without breaking existing users** (§ 11B Mechanics), and the
**provider-managed seed inbox pool** (§ 11C Mechanics). Skim the rest, read those.

Phase 11 ships in three sub-phases (11A → 11B → 11C) each releasable independently.
Phase 11D (cross-channel escape via LinkedIn) is deferred — Nango does not expose
send-as-a-user on LinkedIn as of 2026Q3, so it needs a different integration path.
Deferred spec is at the end.

---

## Cross-cutting decisions locked in

These were confirmed with the product owner before writing this doc:

1. **Canary model = hybrid.** User-provided seed inboxes are the free tier. A
   provider-managed pool operated by Quiksend is the paid "Deliverability Pro" tier.
2. **Routing policy = default-off, big warning.** The workspace policy "Never send
   to SEG from consumer ESP" ships defaulted OFF. The UI surfaces a prominent inline
   warning at enrollment time when the mismatch is detected, and shows a workspace
   settings banner "You have 47 prospects at Proofpoint domains and no
   enterprise-safe mailbox configured — enable the routing guard?". Users opt in
   explicitly.
3. **Phase 11D (LinkedIn) is deferred.** Nango's LinkedIn provider is read-only for
   most APIs; send-as-user requires OAuth scopes LinkedIn no longer grants except to
   enterprise partners. Cross-channel escape needs its own integration surface (likely
   LinkedIn's Marketing Solutions API + Sales Navigator, or a scraping/UI-automation
   path via Browserbase — both are Phase 12+ conversations).

---

## Goal (Phase 11 overall)

Give Quiksend users **direct, real-time visibility into whether their enterprise sends
are landing**, and route around the failure modes automatically when possible. Concretely,
by the end of Phase 11 a user should be able to:

- Import a CSV of 5,000 enterprise prospects and see within 60 seconds "63% behind
  Proofpoint, 19% Mimecast, 9% Microsoft Defender, 9% other" broken down by domain
- Configure sequences with an entry condition "skip if recipient behind Proofpoint"
  from the same UI that already handles `if_no_reply` (built in Wave 5 BETA)
- Tag their mailboxes as `enterprise_safe: true` (aged M365) vs `false` (Gmail) and
  have the engine automatically route SEG-destined sends to the safe mailboxes
- Register a seed inbox they own ("my friend at Acme lets me use their Proofpoint
  inbox for testing") and see a live deliverability grid updating every 5 minutes
- Optionally upgrade to Deliverability Pro and use Quiksend's own pool of seed inboxes
  across all four major SEGs — no need to find friends with the right corporate email

Success metric: **users who complete a campaign with SEG-tagged prospects see the
actual delivery rate to those SEGs, not the ESP's "sent OK" phantom rate.** If the
delivery rate drops below 80% mid-campaign, the campaign auto-pauses with an alert.

---

## Builds on (existing modules Phase 11 attaches to)

| Module                                                            | Origin                        | Phase 11 usage                                                                      |
| ----------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `packages/mail/src/dns.ts`                                        | Phase 4                       | Extended with MX resolution (`resolveMx`) and MX-based provider classification      |
| `packages/mail/src/adapters/index.ts` (`createAdapterForMailbox`) | Phase 4 + Wave 5 CR-009       | Content sanitizer path added inside adapter chain when recipient is SEG-tagged      |
| `packages/core/src/state-machine/entry-conditions.ts`             | Wave 5 BETA COMP-005          | Extended with `if_recipient_gateway_in` / `if_recipient_gateway_not_in`             |
| `apps/worker/src/sequence/reserve-slot.ts`                        | Wave 5 ALPHA CR-005           | Extended with gateway-aware mailbox selection + lower throttle for SEG destinations |
| `apps/worker/src/sequence/effects.ts` (`applyMailboxSend`)        | Wave 5 ALPHA CR-004           | Injects `X-Quiksend-Canary-Id` header, calls content sanitizer if recipient is SEG  |
| `apps/web/src/lib/effect-executor.ts` (`applyWebEffects`)         | Wave 6 OMEGA ARCH-002         | New effect kind `emit_canary` handled here for the web-triggered manual-send path   |
| `apps/worker/src/handlers/mailbox-poll.ts`                        | Phase 4 + Wave 5 DELTA CR-012 | Pattern reused for seed-inbox polling; separate handler `canary-check.ts`           |
| `packages/queue/src/jobs.ts`                                      | Phase 6                       | New job types: `gateway.detect`, `canary.poll`, `canary.sweep`                      |
| `packages/ai/src/classify/sentiment.ts`                           | Wave 5 BETA COMP-006          | Sibling classifier for canary send: `packages/ai/src/classify/canary-arrival.ts`    |
| `analytics.functions.ts` + `sequence_stats` view                  | Phase 9 + Wave 6 PERF-008     | Extended with `by_gateway` breakdowns                                               |

Nothing in Phase 11 requires a greenfield architectural addition. Every arrow lands
on a module that already exists and has been production-hardened.

---

## Consolidated entity map (additions to what Phases 2–10 built)

New tables:

- `gateway_classification` — a cache of `(email_domain, gateway, mx_records[],
evidence[], classified_at)` shared across all workspaces. Domain-level cache, not
  org-scoped: Proofpoint's MX for `acme.com` is the same regardless of who's looking
  it up. Bump `classified_at` to trigger re-check.
- `seed_inbox` — org-scoped for user-provided seeds, or `organization_id = NULL` for
  provider-managed seeds owned by Quiksend Systems. Fields: `id`, `organization_id
(nullable)`, `email`, `gateway`, `provider` (`m365 | google_workspace`),
  `imap_config` (encrypted jsonb: host/port/username/password), `verified_at`,
  `active`, `notes`, `pool_tag` (only for provider-managed: `production | canary_only
| warmup`), `created_at`, `updated_at`.
- `canary_send` — one row per canary injected into a campaign. Fields: `id`,
  `organization_id`, `sequence_id`, `enrollment_id (nullable — canaries have no
prospect)`, `mailbox_id (sender)`, `seed_inbox_id (target)`, `canary_token uuid
(goes in X-Quiksend-Canary-Id header)`, `subject`, `sent_at`, `expected_arrival_at`,
  `arrived_at (nullable)`, `arrival_gateway_headers (jsonb)`, `arrival_folder
(nullable: 'inbox' | 'spam' | 'quarantine' | 'not_found')`, `arrival_status pg enum
('pending' | 'arrived_inbox' | 'arrived_spam' | 'arrived_quarantine' |
'silent_drop' | 'bounced')`, `created_at`.
- `deliverability_snapshot` — periodic rollup, one row per (org, sender_mailbox,
  recipient_gateway, window_start). Fields: `id`, `organization_id`, `mailbox_id`,
  `gateway`, `window_start`, `window_end`, `canary_total`, `canary_delivered`,
  `canary_spam`, `canary_quarantine`, `canary_silent_dropped`, `deliverability_pct`,
  `created_at`. Feeds the deliverability grid dashboard.

Extended tables (from earlier phases):

- `prospect`: add `email_gateway gateway_type` (pg enum, nullable) + `gateway_classified_at
timestamptz nullable` + `gateway_evidence jsonb nullable`. Index `(organization_id,
email_gateway) WHERE email_gateway IS NOT NULL AND deleted_at IS NULL` for the "list
  filter by gateway" query.
- `mailbox`: add `enterprise_safe boolean not null default false` + `enterprise_safe_reason
text nullable` (`'m365_aged' | 'user_declared' | 'auto_downgraded'` — the last for
  when we detect a mailbox that previously delivered well is now getting dropped).
- `sequence_step`: extend `entry_condition jsonb` shape to include `recipientGatewayIn?:
Gateway[]` and `recipientGatewayNotIn?: Gateway[]` (jsonb, no migration needed —
  schema-level change only).
- `event` table: three new `type` string values used by observers/analytics: `gateway.detected`,
  `gateway.routing_skipped_no_safe_mailbox`, `canary.silent_drop_detected`. No schema
  change (event.type is `text`).

New enums:

```sql
CREATE TYPE gateway_type AS ENUM (
  'proofpoint', 'mimecast', 'barracuda', 'cisco_ironport', 'trend_micro',
  'fortinet', 'sophos', 'symantec', 'google_workspace', 'microsoft_365',
  'zoho', 'fastmail', 'other', 'unknown'
);

CREATE TYPE canary_arrival_status AS ENUM (
  'pending', 'arrived_inbox', 'arrived_spam', 'arrived_quarantine',
  'silent_drop', 'bounced'
);

CREATE TYPE seed_inbox_pool_tag AS ENUM (
  'production', 'canary_only', 'warmup'
);
```

---

# Phase 11A — Detection + Segmentation

## Goal (Phase 11A)

Every prospect in the database has an accurate `email_gateway` classification within
seconds of being created (manual add, CSV import, CRM sync, or API). Users can see
per-prospect gateway badges in the UI, filter prospect lists by gateway, and read
list-level "SEG mix" summaries. Sequence steps can be conditionally skipped based on
recipient gateway. This is a **read-only diagnostic feature** — no send behavior
changes yet.

## Builds on

- `packages/mail/src/dns.ts` — existing `checkSpf`, `checkDkim`, `checkDmarc`.
  Extended.
- `packages/mail/package.json` — depends on `node:dns/promises` (built-in, already
  used).
- `packages/queue` — `enqueue()` wrapper from Phase 6, `enqueueWithRetries` from
  Wave 5 EPSILON.
- `packages/core/src/state-machine/entry-conditions.ts` — the pure evaluator built in
  Wave 5 BETA. Extended with two new predicate fields.
- Wave-5 BETA-shipped `apps/web/src/lib/prospects.functions.ts` `getProspectMessages`
  pattern for adding new server-fns.
- Wave-6 OMEGA-shipped `apps/web/src/lib/analytics.functions.ts` `withAnalyticsTiming`
  wrapper for the new gateway-mix server-fn.

## Data model

### `gateway_classification` (new — domain-level cache, no org scoping)

```typescript
export const gatewayClassification = pgTable(
  "gateway_classification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailDomain: text("email_domain").notNull().unique(),
    gateway: gatewayTypeEnum("gateway").notNull(),
    mxRecords: jsonb("mx_records").notNull(), // string[]
    evidence: jsonb("evidence").notNull(), // { kind: "mx"|"spf"|"dmarc"|"heuristic", detail: string }[]
    confidence: pgEnum("gateway_classification_confidence", [
      "high",
      "medium",
      "low",
    ])("confidence").notNull(),
    classifiedAt: timestamp("classified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ttlUntil: timestamp("ttl_until", { withTimezone: true }).notNull(), // rec-classify after this
  },
  (t) => [
    index("gateway_classification_gateway_idx").on(t.gateway),
    index("gateway_classification_ttl_idx").on(t.ttlUntil),
  ],
);
```

**Why not org-scoped:** the MX records for `acme.com` are public global DNS. Anyone
looking up `acme.com` gets the same answer. Caching per domain, not per workspace,
massively reduces DNS queries — 100 workspaces each importing the same Fortune-500
CSV pays for one MX lookup total, not 100.

**Cache TTL:** 30 days by default; 7 days if `confidence = 'low'` (nudges re-check
on ambiguous domains). SEG migrations do happen — Acme might move from Proofpoint to
Microsoft Defender — so we don't cache indefinitely.

### Extend `prospect`

```typescript
// packages/db/src/schema/prospects.ts additions:
emailGateway: gatewayTypeEnum("email_gateway"),
gatewayClassifiedAt: timestamp("gateway_classified_at", { withTimezone: true }),
gatewayEvidence: jsonb("gateway_evidence").$type<GatewayEvidence[]>(),

// index for "list prospects by gateway" queries
// (only prospects with a known gateway and not deleted)
index("prospect_org_gateway_idx")
  .on(t.organizationId, t.emailGateway)
  .where(sql`${t.emailGateway} IS NOT NULL AND ${t.deletedAt} IS NULL`),
```

### Extend `sequence_step.entry_condition` jsonb shape

No SQL migration — the column is already `jsonb`. The Zod schema in
`packages/core/src/state-machine/entry-conditions.ts` gains two optional fields:

```typescript
export const EntryConditionSchema = z.object({
  ifNoReplyOnThread: z.boolean().optional(),
  ifNoBounceOnThread: z.boolean().optional(),
  // NEW in Phase 11A:
  recipientGatewayIn: z.array(GatewayTypeSchema).optional(),
  recipientGatewayNotIn: z.array(GatewayTypeSchema).optional(),
});
```

The pure evaluator gains two branches:

```typescript
if (
  condition.recipientGatewayIn &&
  ctx.recipientGateway &&
  !condition.recipientGatewayIn.includes(ctx.recipientGateway)
) {
  return { proceed: false, skipReason: "recipient_gateway_not_in_allow_list" };
}
if (
  condition.recipientGatewayNotIn &&
  ctx.recipientGateway &&
  condition.recipientGatewayNotIn.includes(ctx.recipientGateway)
) {
  return { proceed: false, skipReason: "recipient_gateway_in_deny_list" };
}
```

`ctx.recipientGateway` is a new field on `EnrollmentContextForCondition` (already
extensible in Wave 5 BETA).

## Server surface (all `orgFn`-wrapped)

- **`classifyEmail({ email })` → `{ gateway, evidence, cached: bool }`** — sync,
  reads the domain cache first; enqueues background classification if cache miss and
  returns `{ gateway: 'unknown', cached: false }` immediately (the background job
  populates the cache and re-classifies prospects on the next tick).
- **`reclassifyDomain({ emailDomain })` → `{ success: bool }`** — admin action, force
  cache invalidation + re-classification of all prospects at that domain.
- **`getGatewayMixForOrg({})` → `Array<{ gateway, count, pct }>`** — feeds the
  workspace overview "SEG mix" card.
- **`getGatewayMixForList({ listId })` → same shape** — per-list breakdown.
- **`getGatewayMixForSequence({ sequenceId })` → same shape** — per-sequence
  breakdown (of enrolled prospects). Used by the sequence detail page's new
  "Deliverability outlook" panel.

Reads use `withAnalyticsTiming` (Wave 6 OMEGA PERF-010) since these queries touch
the whole prospect table.

## UI

### 1. Prospect card + prospect list

- Every prospect card and list row gets a small badge next to the email:
  `[Proofpoint]` (red), `[Mimecast]` (orange), `[Microsoft 365]` (blue),
  `[Google Workspace]` (green), `[Unknown]` (gray, small). Tooltip shows the evidence
  ("MX records point to `pphosted.com`, DMARC includes `d.pphmx.org`").
- Prospect list gets a new filter chip "Gateway" with checkbox selection — matches
  the existing pattern for status/list filters.
- List detail page gets a compact SEG mix bar chart at the top: horizontal stacked
  bar with percentages.

### 2. Sequence step editor

`apps/web/src/routes/_protected/sequences/$id/edit.tsx` — each step's entry-condition
picker (already exists from Wave 5 BETA COMP-005) gains two new options:

- "Only send if recipient is behind: [multi-select]" (`recipientGatewayIn`)
- "Never send if recipient is behind: [multi-select]" (`recipientGatewayNotIn`)

The multi-select uses the standard shadcn `Popover + Command + CheckboxItem` combo
already used elsewhere.

### 3. Workspace overview page

`apps/web/src/routes/_protected/index.tsx` (the dashboard from Phase 9) gets a new
card "Prospect gateway mix" below the workspace overview. Renders a Recharts horizontal
bar. Includes a subtle "% classified" counter — if < 90%, shows a spinner "Classifying
in background, refresh in a minute."

### 4. Sequence detail — "Deliverability outlook" panel

`apps/web/src/routes/_protected/sequences/$id/index.tsx` — new panel that shows:

- SEG mix of enrolled prospects
- (If any prospects behind SEGs) a warning "This sequence enrolls N prospects at
  Proofpoint/Mimecast. None of your mailboxes are marked `enterprise_safe`. See
  [Deliverability guide]."
- The warning is what surfaces the routing policy from Phase 11B before 11B ships.

## Mechanics

### The detection cascade (most important part of Phase 11A)

```typescript
// packages/mail/src/gateway-detect.ts

export type EmailGateway =
  | "proofpoint"
  | "mimecast"
  | "barracuda"
  | "cisco_ironport"
  | "trend_micro"
  | "fortinet"
  | "sophos"
  | "symantec"
  | "google_workspace"
  | "microsoft_365"
  | "zoho"
  | "fastmail"
  | "other"
  | "unknown";

export interface GatewayEvidence {
  kind: "mx" | "spf" | "dmarc" | "arc_seal" | "heuristic";
  detail: string;
}

export interface GatewayDetectionResult {
  gateway: EmailGateway;
  evidence: GatewayEvidence[];
  confidence: "high" | "medium" | "low";
  mxRecords: string[];
}

export async function detectEmailGateway(
  email: string,
): Promise<GatewayDetectionResult>;
```

**Detection order (short-circuiting on high confidence):**

1. **MX lookup** — `resolveMx(domain)` → array of `{ exchange, priority }`. Match
   against the fingerprint table (below). Most enterprise SEGs have distinctive MX
   patterns; match is high-confidence.

2. **DMARC record inspection** — if MX is ambiguous (e.g. cname to a generic host),
   check DMARC. `_dmarc.acme.com` TXT often contains `rua=mailto:dmarc@some-seg.com`
   pointing to Proofpoint's DMARC aggregator, or `mailto:dmarc-reports@barracudanetworks.com`.
   Medium confidence.

3. **SPF inspection** — SPF `include:` directives leak the SEG. Proofpoint has
   `include:_spf.pphosted.com`, Mimecast has `include:_netblocks.mimecast.com`, etc.
   Medium confidence.

4. **ARC-Authentication-Results header sniff (deferred to bounce-processing path in
   11C)** — if we have a real inbound message from a domain (e.g. a reply on an
   existing sequence), we can read `Authentication-Results` headers to identify the
   transiting SEG. Highest confidence signal because it's proof the message actually
   passed through that SEG. Only usable when we have prior mail from the domain.

5. **Fallback heuristics** — some very common patterns: `.protection.outlook.com` MX
   = raw M365 with no SEG in front. `.googlemail.com` MX = Google Workspace. Low
   confidence if only relying on this.

### MX fingerprint table

```typescript
const MX_FINGERPRINTS: Array<{
  pattern: RegExp;
  gateway: EmailGateway;
  confidence: "high" | "medium";
}> = [
  // Proofpoint
  { pattern: /\.pphosted\.com$/i, gateway: "proofpoint", confidence: "high" },
  { pattern: /\.ppe-hosted\.com$/i, gateway: "proofpoint", confidence: "high" },
  // Mimecast
  { pattern: /\.mimecast\.com$/i, gateway: "mimecast", confidence: "high" },
  {
    pattern: /\.mimecast\.co\.[a-z]+$/i,
    gateway: "mimecast",
    confidence: "high",
  },
  // Barracuda
  {
    pattern: /\.barracudanetworks\.com$/i,
    gateway: "barracuda",
    confidence: "high",
  },
  { pattern: /barracuda\.com$/i, gateway: "barracuda", confidence: "high" },
  {
    pattern: /\.essentialscloud\.com$/i,
    gateway: "barracuda",
    confidence: "high",
  },
  // Cisco IronPort / Cisco Secure Email
  { pattern: /\.iphmx\.com$/i, gateway: "cisco_ironport", confidence: "high" },
  {
    pattern: /\.cisco\.com$/i,
    gateway: "cisco_ironport",
    confidence: "medium",
  },
  // Trend Micro
  { pattern: /trendmicro\.com$/i, gateway: "trend_micro", confidence: "high" },
  {
    pattern: /tmes\.trendmicro\.com$/i,
    gateway: "trend_micro",
    confidence: "high",
  },
  // Fortinet FortiMail
  { pattern: /fortinet\.com$/i, gateway: "fortinet", confidence: "medium" },
  { pattern: /\.fortimail\.com$/i, gateway: "fortinet", confidence: "high" },
  // Sophos
  { pattern: /sophos\.com$/i, gateway: "sophos", confidence: "medium" },
  { pattern: /\.mail\.sophos\.com$/i, gateway: "sophos", confidence: "high" },
  // Symantec / Broadcom
  { pattern: /messagelabs\.com$/i, gateway: "symantec", confidence: "high" },
  { pattern: /symantec\.cloud$/i, gateway: "symantec", confidence: "high" },
  // Google Workspace (no SEG in front)
  {
    pattern: /aspmx\.l\.google\.com$/i,
    gateway: "google_workspace",
    confidence: "high",
  },
  {
    pattern: /googlemail\.com$/i,
    gateway: "google_workspace",
    confidence: "high",
  },
  {
    pattern: /\.googlemail\.com$/i,
    gateway: "google_workspace",
    confidence: "high",
  },
  // Microsoft 365 (no SEG in front)
  {
    pattern: /\.mail\.protection\.outlook\.com$/i,
    gateway: "microsoft_365",
    confidence: "high",
  },
  { pattern: /\.outlook\.com$/i, gateway: "microsoft_365", confidence: "high" },
  // Zoho
  { pattern: /zoho\.com$/i, gateway: "zoho", confidence: "high" },
  { pattern: /zohomail\.com$/i, gateway: "zoho", confidence: "high" },
  // Fastmail
  {
    pattern: /messagingengine\.com$/i,
    gateway: "fastmail",
    confidence: "high",
  },
];
```

**Nuance:** the table is deliberately not-in-code-as-hard-constants — it lives in a
config file the team can update without a code change. See §11A Ticket 3.

### The "Google Workspace + Proofpoint" split-brain case

A common enterprise pattern: **inbound routes through Proofpoint, storage is Google
Workspace**. The MX record points to Proofpoint (because inbound filtering happens
there first), but the actual mailbox is Google-hosted. This is the case that matters
most for SEG routing:

- **The MX-based classification returns `proofpoint`.** Correct — because the SEG
  IS actively filtering inbound. That's what we route around.
- **The UI should be clear:** the badge says "Proofpoint" (that's what filters), and
  a tooltip explains "Inbound routed through Proofpoint → storage on Google Workspace".
- **The routing decision (Phase 11B) uses the SEG classification** — because that's
  what silently drops us. The storage layer being Google Workspace doesn't help.

Implementation: `detectEmailGateway` returns the first SEG in the MX chain, not the
final storage. That's the right semantic.

### Classification cost + batching

An MX lookup is a UDP DNS query — ~5–50ms typically, occasionally seconds if the
upstream nameserver is slow. For a 5,000-prospect CSV import, we can't do 5,000
classifications synchronously.

**Import path (CSV / CRM sync):**

1. Enqueue a `gateway.detect_bulk` job with the batch of `email_domain` uniqued
   values.
2. Worker handler processes 100 domains in parallel, respects a 5s timeout per
   lookup, writes to `gateway_classification` cache.
3. Enqueue a follow-up `gateway.apply_classification` job that scans prospects with
   `email_gateway IS NULL` and back-fills `prospect.email_gateway` from the cache.

**Manual add path:**

1. Server-fn `createProspect` returns immediately, prospect saved with
   `email_gateway = null`.
2. Enqueue `gateway.detect_single { email }` job.
3. On completion, `prospect.email_gateway` is UPDATE'd, and an `event` row of type
   `gateway.detected` is inserted (optional — used for analytics).

**Refresh cycle:**

- Cron `gateway.sweep_stale` runs daily. Finds `gateway_classification` rows with
  `ttl_until < now()`, re-classifies. If gateway changed, updates all prospects at
  that domain via `UPDATE prospect SET email_gateway = new_gateway WHERE ...`.

### Rate limiting DNS queries

`dns.resolveMx` uses the OS resolver (typically /etc/resolv.conf → local resolver →
Cloudflare/Google DNS). No per-second cap by the OS but we should be polite:

- Semaphore of 50 concurrent MX lookups per worker process
- If a single domain's lookup fails (SERVFAIL, timeout), retry once with exponential
  backoff, then cache as `unknown` with a 24-hour TTL (short — retry next day, not
  next month)
- Track lookup failure rate as a metric; if > 5% over 5-minute window, alert (may
  indicate DNS provider issue)

## Tickets (11A)

11A.1 — **Migration + enum**. New table `gateway_classification`. Enums
`gateway_type` + `gateway_classification_confidence`. Extend `prospect` with
`email_gateway`, `gateway_classified_at`, `gateway_evidence`. Add composite index.

11A.2 — **`packages/mail/src/gateway-detect.ts`**. Implement `detectEmailGateway()`
with the cascade. Include the MX fingerprint table (initially embedded, later
externalized in 11A.3). Unit tests use `vi.mock` on `node:dns/promises` and cover
each SEG plus the split-brain case.

11A.3 — **Fingerprint table externalization**. Move `MX_FINGERPRINTS` to a `.json`
file at `packages/mail/src/gateway-fingerprints.json`. Provides a git-diffable audit
trail when the team adds new patterns. Loaded at module init.

11A.4 — **Worker handlers**: `gateway.detect_single`, `gateway.detect_bulk`,
`gateway.apply_classification`, `gateway.sweep_stale`. All in
`apps/worker/src/handlers/gateway-detect.ts`. Idempotent, respects DNS semaphore.

11A.5 — **Server functions**: `classifyEmail`, `reclassifyDomain`,
`getGatewayMixForOrg`, `getGatewayMixForList`, `getGatewayMixForSequence`. Wrap
reads with `withAnalyticsTiming`. Wrap `reclassifyDomain` with admin-role gate.

11A.6 — **Prospect create/import wiring**. `createProspect` server-fn +
`import-prospects.ts` worker → enqueue detection.

11A.7 — **Extend entry-conditions.ts**. New fields on `EntryConditionSchema`, new
branches in `evaluateEntryCondition`, unit tests for each.

11A.8 — **UI: prospect badge + list filter + list detail bar chart**. Reuse the
`shadcn Badge` + `Recharts BarChart` already imported.

11A.9 — **UI: sequence step editor** — extend the entry-condition picker with the
two new multi-select fields.

11A.10 — **UI: workspace overview "gateway mix" card** + **sequence detail
"deliverability outlook" panel**.

11A.11 — **Integration test** — CSV import a 200-row list, wait for all
classifications to complete, assert every row has a gateway (or `unknown`),
assert `gateway_classification` cache has the expected domain count.

## Testing (11A)

- **Unit** (Vitest, no DB): `gateway-detect.test.ts` mocks DNS with fixture data for
  each SEG + the split-brain case. Fingerprint patterns tested individually.
- **Unit** (Vitest, no DB): `entry-conditions.test.ts` extended with new predicate
  branches.
- **Integration** (Vitest + real Postgres): a full test-org lifecycle — import CSV,
  wait for background classification, assert prospect rows populated. Uses a
  DNS-mocked worker: `apps/worker/src/handlers/gateway-detect.test.ts` mocks the
  actual `resolveMx` call.
- **Tenancy**: `apps/web/src/lib/gateway-tenancy.test.ts` — org A cannot see org B's
  prospect gateway data; but `gateway_classification` cache is shared (that's
  intentional — assert it).
- **CI load-test extension**: add a mode `--test-mode=gateway-detection` to
  `scripts/load-test-engine.ts` — seeds 500 prospects across 50 fake domains,
  asserts all classifications complete within 30s.

## Risks & decisions (11A)

- **DNS resolver reliability.** Local DNS resolver failures or rate-limits could
  bottleneck classification. Mitigation: fall back to Cloudflare DoH (`1.1.1.1`) via
  HTTPS if `node:dns` fails 3 consecutive times. Deferred to 11A.4 follow-up.
- **Cache correctness under DNS changes.** If Acme migrates SEGs, we won't know for
  up to 30 days (TTL). Users can manually `reclassifyDomain` to force refresh.
  Deferred: auto-invalidation on bounce (if a prospect at a supposedly Google-
  Workspace domain suddenly gets a Proofpoint bounce header, invalidate cache).
- **`gateway_classification` cache pollution.** If an adversary creates 10k
  workspaces and imports 10k unique domains, they DoS the DNS lookup queue. Mitigate
  with per-workspace daily rate limit on new domain lookups (e.g. 5k/day/org). Not
  strictly needed for MVP but note in RUNBOOK.md.
- **What counts as "SEG"?** Google Workspace's built-in filtering is _not_ a SEG
  from Quiksend's perspective — Gmail-to-Workspace paths deliver reliably. Only
  classify as SEG the third-party gateways that would silently drop consumer-ESP
  sends. `google_workspace` and `microsoft_365` are gateways in the enum for
  completeness but the routing logic (Phase 11B) treats them as safe.

## Exit criteria (11A)

- All 11A.1–11A.11 tickets shipped and merged.
- `pnpm check` green with new tests.
- 5,000-prospect CSV import completes classification within 60 seconds on the
  standard CI Postgres box.
- Manual smoke test: import 20 prospects covering all 4 major SEGs (verified via
  real MX lookups outside the tool), see correct badges within 10 seconds.
- Documentation: `docs/deliverability.md` (new) explains what SEGs are, how Quiksend
  classifies, and what users can do with the information. Not gated on 11B.

---

# Phase 11B — Routing

## Goal (Phase 11B)

Users can configure their mailboxes as `enterprise_safe` (aged M365) or not (Gmail /
consumer ESPs). The engine automatically routes SEG-destined sends to enterprise-safe
mailboxes when the workspace has opted into the routing policy. Content sent to
SEG-tagged prospects is automatically sanitized (no tracking pixel, no external
images, lower velocity). Users who haven't configured the policy see prominent
warnings in the UI at enrollment time.

## Builds on

- `apps/worker/src/sequence/reserve-slot.ts` — Wave 5 ALPHA's atomic reservation. The
  gateway-aware routing decision happens **before** the advisory lock is taken.
- `apps/worker/src/sequence/mailbox-adapter.ts` — the adapter resolution point.
  Content sanitizer plugs in here as a wrapper around the adapter's `send()`.
- `packages/mail/src/mime.ts` — `buildMime()` is where the content sanitizer runs.
- `apps/web/src/lib/effect-executor.ts` — Wave 6 OMEGA's shared executor. Extended
  with a new effect kind `skip_no_safe_mailbox` that emits a `enrollment.paused`
  event with a specific reason.
- `packages/core/src/state-machine/transition.ts` — new event `no_safe_mailbox`
  and new nextState/effects handling (also emits `enrollment.paused`).

## Data model

Extensions only, no new tables:

- `mailbox.enterprise_safe boolean not null default false` — set by user, admin-role
  gated.
- `mailbox.enterprise_safe_reason text nullable` — free-text why (`"M365 aged 6mo"`,
  `"Dedicated IP relay"`, etc.) — surfaced in UI + logs.
- `mailbox.enterprise_safe_declared_at timestamp nullable` — when the user flipped
  the flag. Used to gate the "aged" heuristic.
- `mailbox.enterprise_safe_auto_downgraded boolean not null default false` — set
  automatically by the Phase 11C canary detector if this mailbox's actual
  deliverability drops. Overrides `enterprise_safe = true` temporarily; user can
  clear via UI.

- **Workspace policy** — stored in `organization.metadata` jsonb (already exists,
  extended). Shape:
  ```typescript
  organization.metadata.deliverability = {
    routingPolicy: "off" | "warn" | "enforce"; // default "off"
    routingPolicyChangedAt?: string;
    routingPolicyChangedBy?: string; // userId
    contentSanitizerEnabled: boolean; // default: matches routingPolicy != "off"
  }
  ```

## Server surface (`orgFn` unless noted)

- **`setMailboxEnterpriseSafe({ mailboxId, safe: bool, reason?: string })`** — admin
  role gate. Sets the flags. Emits `event` type `mailbox.enterprise_safe_toggled`.
- **`getWorkspaceDeliverabilityPolicy({})`** → returns the policy jsonb.
- **`setWorkspaceDeliverabilityPolicy({ routingPolicy, contentSanitizerEnabled? })`**
  — admin only. Persists to `organization.metadata`. Emits `event`.
- **`previewRoutingImpact({})`** → returns:
  ```typescript
  {
    prospectsBehindSeg: number;
    safeMailboxCount: number;
    prospectsAtRiskOfSkip: number; // = prospectsBehindSeg if safeMailboxCount == 0
    prospectsPerGatewayWithSafeMailbox: Array<{ gateway; count }>;
  }
  ```
  Shown in the settings page when the user is about to toggle the policy — "You are
  about to enable the routing guard. This would skip 47 enrollments in your active
  sequences until you add an enterprise-safe mailbox."

## UI

### 1. Mailbox settings page (`_protected/settings/mailboxes/index.tsx`)

Each mailbox row gets a new "Enterprise-safe" toggle switch. Off by default. When
toggled on, opens a modal:

> **Mark [my-gmail@example.com] as enterprise-safe?**
>
> Enterprise-safe mailboxes are used when Quiksend routes around SEGs (Proofpoint /
> Mimecast / Barracuda). Consumer ESPs like Gmail are usually **NOT** enterprise-safe
> — sends to SEG-protected recipients get silently dropped.
>
> - Aged Microsoft 365 tenant (6+ months old): ✅ safe
> - Dedicated IP transactional relay (warmed): ✅ safe
> - Google Workspace (any age): ⚠️ risky
> - Gmail: ❌ not safe
>
> If you enable this and the mailbox actually can't reach SEGs, the canary system
> (Phase 11C) will auto-downgrade it and alert you.
>
> Reason (optional): [text field]
>
> [Cancel] [Mark safe]

### 2. Workspace settings — Deliverability section (new)

New route `_protected/settings/deliverability.tsx`:

- **Routing policy** — radio group: "Off (default)", "Warn only", "Enforce (auto-skip)"
  - Off: engine sends regardless; warning banners on relevant pages
  - Warn: engine sends but emits `event` per skip-worthy send + adds warning banner
    on sequence detail
  - Enforce: engine actually skips (pauses enrollment with `no_safe_mailbox_for_gateway`
    reason). Requires `previewRoutingImpact` review before allowing toggle-on if
    `safeMailboxCount == 0`.
- **Content sanitizer** — checkbox: "Strip tracking pixels + external images for
  SEG-destined sends" (default: on when policy != "off")
- **Preview** — inline `previewRoutingImpact` numbers, updates on radio change
- **Save** — big button. Confirmation modal if switching from `off` → `enforce`.

### 3. Sequence detail — warning banner

Extension of the "Deliverability outlook" panel from 11A. When a sequence has
prospects behind SEGs AND no enterprise-safe mailbox exists in the workspace, show a
prominent red banner:

> ⚠️ **Deliverability risk**
> This sequence enrolls 47 prospects at Proofpoint domains. None of your mailboxes
> are marked enterprise-safe.
>
> Options:
>
> - [Enable routing guard] — skip these enrollments until you configure a safe mailbox
> - [Learn more] — link to `docs/deliverability.md`
> - [Ignore] — you can proceed and monitor delivery in analytics

### 4. Enrollment dialog — inline warning

The "Enroll prospects" dialog (from Wave 5 BETA) — when the user selects a set that
includes SEG-tagged prospects, show a compact inline warning:

> This selection includes 12 prospects behind Proofpoint. Your current mailboxes are
> Gmail (not enterprise-safe). [Learn more]

Non-blocking; user can proceed.

## Mechanics

### The routing decision

The engine's decision path is:

1. Enrollment's step becomes runnable, tick claims the job.
2. `execute-step.ts` loads context: enrollment + prospect + sequence + step +
   mailbox + `recipientGateway` from prospect. **Pass gateway into the routing
   selector.**
3. New module `apps/worker/src/sequence/mailbox-router.ts`:

   ```typescript
   export async function selectMailboxForSend(
     tx: DrizzleTx,
     orgId: string,
     enrollment: Enrollment,
     recipientGateway: EmailGateway | null,
     policy: DeliverabilityPolicy,
   ): Promise<
     | { kind: "route"; mailboxId: string }
     | { kind: "skip"; reason: "no_safe_mailbox_for_gateway"; emitEvent: true }
     | { kind: "skip"; reason: "policy_off_but_warn"; emitEvent: true }
   >;
   ```

   Decision table:

   | policy  | recipient gateway | safe mailboxes exist? | current mailbox safe? | outcome                                                   |
   | ------- | ----------------- | --------------------- | --------------------- | --------------------------------------------------------- |
   | off     | any               | —                     | —                     | route to current mailbox, no warning                      |
   | warn    | non-SEG           | —                     | —                     | route to current mailbox                                  |
   | warn    | SEG               | yes                   | no                    | route to a safe mailbox (auto-swap) + emit event          |
   | warn    | SEG               | no                    | —                     | route to current mailbox + emit event (delivered_at_risk) |
   | enforce | non-SEG           | —                     | —                     | route to current mailbox                                  |
   | enforce | SEG               | yes                   | no                    | route to a safe mailbox (auto-swap) + emit event          |
   | enforce | SEG               | no                    | —                     | **skip** (enrollment.paused with reason), emit event      |

   Note the "auto-swap" case: when the current mailbox isn't safe but a safe one
   exists, the engine transparently reroutes. Anchor threading needs care — see
   next.

4. **Anchor threading concern:** if the enrollment has an `anchor_message_id` from a
   manual first-send on Mailbox A, and we auto-swap to Mailbox B for the follow-up,
   we break threading — the follow-up won't appear in the same thread on the
   recipient's side.

   **Resolution:** anchor-bound enrollments (`anchor_message_id IS NOT NULL`) skip
   the auto-swap. The routing decision falls through to `keep current mailbox +
emit event`. Rationale: threading integrity is more important than routing
   optimization once an anchor exists. Document this trade-off in
   `docs/deliverability.md`.

5. The `selectMailboxForSend` result feeds into the existing
   `reserveSendSlotInTx()` call. If `kind === "skip"`, we set enrollment state to
   `paused`, insert an `event` row, and skip the reservation entirely.

### Auto-swap safe-mailbox selection

Among safe mailboxes, pick the least-loaded (by current 24h send count). Existing
`countReservationsInWindow` from Wave 5 already does this — call it per safe
mailbox and pick the lowest. Same-provider preference: if user has 3 M365 safe
mailboxes + 1 SMTP safe mailbox, prefer M365 (Microsoft→Microsoft trust).

### Content sanitizer

New module `packages/mail/src/content-sanitizer.ts`:

```typescript
export function sanitizeForSeg(
  mime: BuiltMime,
  options: {
    stripTrackingPixel: boolean;
    stripExternalImages: boolean;
    preferPlainText: boolean;
  },
): BuiltMime;
```

- Strip tracking pixel: remove `<img>` tags with `src` matching Quiksend's tracking
  domain
- Strip external images: remove or inline as base64 (small images only, <100KB)
- Prefer plain text: `Content-Type: multipart/alternative` with text/plain first,
  drop the HTML part entirely if the text version is complete
- **Called in `effects.ts:handleSendAuto` before adapter.send if recipient
  gateway is SEG AND policy sanitizer is on.**

Unit tests cover each transformation independently.

### Throttle adjustments for SEG destinations

Existing throttle in `reserve-slot.ts` uses per-mailbox 24h cap. Add per-mailbox
per-gateway sub-cap:

```typescript
// If recipient is SEG, apply the lower of (mailbox_cap, seg_sub_cap)
const effectiveCap =
  recipientGateway === "google_workspace" ||
  recipientGateway === "microsoft_365"
    ? mailbox.dailyCap // no reduction for non-SEG
    : Math.min(mailbox.dailyCap, SEG_SUB_CAP); // default 50
```

`SEG_SUB_CAP` starts as an env var (`SEG_DAILY_CAP_PER_MAILBOX`, default 50), can be
overridden per-mailbox later via a new admin UI.

### 5-min gap between two sends to same recipient domain

Existing per-mailbox `send_reservation` table tracks recipient_email (add
`recipient_domain` if not present, extract at insert time). Add a new pre-check in
the reservation transaction:

```sql
-- Inside the advisory lock, before insert:
SELECT count(*)
FROM send_reservation
WHERE mailbox_id = $1
  AND recipient_domain = $2
  AND reserved_at > now() - interval '5 minutes'
```

If count >= 1, defer this send by 5 minutes (`schedule_at`) instead of reserving now.

## Tickets (11B)

11B.1 — **Migration**: add `mailbox.enterprise_safe` + related columns. Extend
`send_reservation.recipient_domain` if missing. Extend
`organization.metadata.deliverability` shape validation.

11B.2 — **Routing selector** — `apps/worker/src/sequence/mailbox-router.ts`. Full
implementation of `selectMailboxForSend` including auto-swap and anchor exception.
Unit tests exhaustive over the decision table.

11B.3 — **Content sanitizer** — `packages/mail/src/content-sanitizer.ts`. Unit
tests per transformation. Integration test: sanitize a full multipart MIME, assert
output still parseable + no tracking pixel + text/plain first.

11B.4 — **Throttle adjustments** — extend `reserve-slot.ts` with SEG sub-cap +
5-min per-domain gap. Extend load test to exercise these.

11B.5 — **Server functions**: `setMailboxEnterpriseSafe`,
`getWorkspaceDeliverabilityPolicy`, `setWorkspaceDeliverabilityPolicy`,
`previewRoutingImpact`.

11B.6 — **UI: mailbox settings toggle + reason field** in
`settings/mailboxes/index.tsx`.

11B.7 — **UI: workspace deliverability settings page** — new route
`settings/deliverability.tsx`.

11B.8 — **UI: sequence detail warning banner** and **enrollment dialog inline warning**
(extend the existing Wave-5-BETA dialog).

11B.9 — **State machine extension** — new event `no_safe_mailbox`, new nextState
`paused` with effect `emit_event { type: "enrollment.no_safe_mailbox_for_gateway" }`.

11B.10 — **Integration test** — full flow: enroll 20 prospects behind Proofpoint,
have 0 safe mailboxes, policy = "enforce", assert all 20 pause with correct event
type; then add a safe mailbox, resume enrollments manually, assert they route to it.

## Testing (11B)

- **Unit**: `mailbox-router.test.ts` — full decision table coverage. `content-sanitizer.test.ts`
  — each transformation. `entry-conditions.test.ts` (extended earlier) still passes.
- **Integration**: policy transitions from off→warn→enforce, verify enrollment
  behavior at each policy level.
- **Load test extension**: `--test-mode=seg-routing` — seeds 100 SEG-tagged
  prospects + 2 safe mailboxes + 2 unsafe mailboxes, verifies engine routes
  correctly + throttle sub-cap holds + 5-min domain gap holds.
- **UI test (Playwright, optional)**: user story — new user opens deliverability
  settings, toggles policy on, sees preview numbers, saves, then attempts to enroll
  → sees warning.

## Risks & decisions (11B)

- **Anchor threading vs routing trade-off**. See mechanics section. Documented in
  `docs/deliverability.md`.
- **What if the workspace has only unsafe mailboxes and policy is enforce?** All
  SEG-destined sends pause. This is the user's fault, but noisy — send a summary
  email once per day with a link to the deliverability settings.
- **Backward compatibility of `enterprise_safe = false` default**: existing
  workspaces get all their mailboxes defaulted to `false`. If they had been sending
  successfully to SEGs from Gmail (unlikely but possible), they may see reduced
  send volume when 11C's canary system kicks in. Ship a one-time email to all
  workspaces: "Phase 11 deliverability features shipped — check settings."
- **Content sanitizer breaking custom HTML**. Some users have hand-crafted HTML
  templates. Sanitizer must be conservative and reversible. Ship with a per-
  sequence override flag "Do not sanitize for SEG destinations" for users who
  know what they're doing.

## Exit criteria (11B)

- All 11B.1–11B.10 tickets shipped and merged.
- `pnpm check` green with new tests.
- Load test `--test-mode=seg-routing` passes.
- Manual smoke test: create a workspace, add a Gmail + an "M365-safe" mailbox
  (SMTP with `enterprise_safe = true`), import 20 Proofpoint-domain prospects,
  enroll in a sequence, verify engine routes to the safe mailbox.

---

# Phase 11C — Canary Deliverability

## Goal (Phase 11C)

Real-time detection of silent SEG drops. Users register seed inboxes (their own for
free tier, Quiksend-managed for Deliverability Pro). Campaigns automatically inject
canary sends at random positions. A polling worker checks arrival within N minutes;
if delivery rate drops below threshold, the campaign auto-pauses with an alert. The
UI shows a live "deliverability grid" — rows = user's mailboxes, columns = SEGs,
cells = arrival percentage.

**This is the wedge feature.** No competitor has real-time SEG deliverability
signal. It becomes the primary marketing hook and the natural paid-tier entitlement.

## Builds on

- `apps/worker/src/handlers/mailbox-poll.ts` — pattern for IMAP polling. Copy the
  connection setup, adapt the message-matching logic.
- `packages/mail/src/mime.ts` `buildMime()` — extend to accept an optional
  `canaryToken` that becomes an `X-Quiksend-Canary-Id` header.
- `apps/worker/src/sequence/effects.ts` — where `send_email` effect materializes into
  an actual send. Extended to also handle `send_canary` effect kind.
- `packages/core/src/state-machine/transition.ts` — new effect kind
  `emit_canary_bundle` returned from `tick` when a sequence needs canary injection.
- `apps/web/src/lib/effect-executor.ts` — Wave 6 web executor; extended for
  `emit_canary_bundle` on the manual-anchor path.

## Data model (see Consolidated map)

Three new tables: `seed_inbox`, `canary_send`, `deliverability_snapshot`. See § Data
Model for full column list.

Extensions:

- `sequence.canary_config jsonb` — per-sequence override. Shape:

  ```typescript
  {
    enabled?: boolean; // default: inherit workspace policy
    seedsPerCampaign?: number; // default 3
    injectionStrategy?: "random_position" | "first_then_last" | "every_nth"; // default random_position
    pauseThresholdPct?: number; // default 80
  }
  ```

- `organization.metadata.canary_defaults` — workspace-level canary config, same
  shape.

## Server surface

### Seed inbox management (all `orgFn`, admin role for setters)

- **`listSeedInboxes({})`** — returns user-provided seeds + (if Pro tier)
  provider-managed seeds. Provider-managed seeds show up as read-only entries
  with `provider_managed: true`.
- **`createUserSeedInbox({ email, imapHost, imapPort, imapUsername, imapPassword,
useSsl, notes? })`** — creates a user seed. Encrypts credentials. Enqueues
  `seed_inbox.verify` job.
- **`verifySeedInbox({ seedInboxId })`** — force re-verify. Also enqueued
  automatically after create. Attempts IMAP LOGIN + LIST, sets `verified_at` on
  success.
- **`deleteSeedInbox({ seedInboxId })`** — user seeds only, cascades canary_send
  rows.
- **`toggleSeedInboxActive({ seedInboxId, active })`** — pause without deletion.

### Canary system (org-scoped read; system-owned write via worker)

- **`getDeliverabilityGrid({ windowDays: number })`** — returns:
  ```typescript
  {
    windowStart: string;
    windowEnd: string;
    rows: Array<{
      mailboxId: string;
      mailboxName: string;
      cells: Array<{
        gateway: EmailGateway;
        canaryTotal: number;
        deliveredInbox: number;
        arrivedSpam: number;
        arrivedQuarantine: number;
        silentDropped: number;
        deliverabilityPct: number;
        signal: "green" | "yellow" | "red" | "insufficient_data";
      }>;
    }>;
  }
  ```
- **`getCanaryHistory({ sequenceId?, limit, cursor? })`** — cursor-paginated list
  of canary sends with arrival status.
- **`getWorkspaceCanaryConfig({})`** → `{ enabled, seedsPerCampaign, ... }`.
- **`setWorkspaceCanaryConfig({...})`** — admin only.

### Provider-managed seed access (Pro tier only)

- **`isEntitledToProviderSeeds({})`** → `{ entitled: boolean; expiresAt?: string }`.
  Reads billing state (out of scope for Phase 11; assume `organization.metadata.entitlements`
  jsonb has an `deliverability_pro: { activeUntil: date }` field).
- **`getProviderManagedSeedGateways({})`** → `Array<{ gateway, seedCount, availableFor
workspace: boolean }>`. Lists which SEGs Quiksend has seeds behind.

## UI

### 1. Deliverability settings → "Seed Inboxes" section

Table:

| Email              | Gateway    | Provider           | Verified      | Active | Actions       |
| ------------------ | ---------- | ------------------ | ------------- | ------ | ------------- |
| test@my-friend.com | Proofpoint | M365               | ✅ 2026-07-15 | ✅     | Edit / Delete |
| pro-seed-01@...    | Mimecast   | (Quiksend-managed) | ✅            | ✅     | (read-only)   |

"[Add seed inbox]" button opens a modal:

- Email address
- IMAP host / port / username / password / SSL
- Notes (optional)
- "Test connection" button — attempts IMAP LOGIN before save
- Save

If workspace is not on Pro, a banner: "Add 4 more SEGs (Proofpoint, Mimecast,
Barracuda, Cisco) to your canary coverage with Deliverability Pro — [Learn more]".

### 2. Deliverability grid page (new route)

`_protected/deliverability/index.tsx`:

- Big grid, rows = mailboxes, cols = SEGs. Each cell shows arrival %, sparkline of
  last 14 days, color-coded (green ≥90%, yellow 50-90%, red <50%, gray insufficient data).
- Time window selector (7/14/30 days).
- Click cell → drawer with details: canary history, evidence headers, "Last drop:
  2 hours ago from this mailbox to this SEG".
- Grid updates in real-time via a 30-second polling query (or SSE if we build the
  transport).

### 3. Sequence detail — canary indicator

Extension of the "Deliverability outlook" panel from 11A/11B. When canary is enabled
and there are recent canary sends associated with this sequence's mailboxes:

- Live-updating "Live deliverability for this campaign: 94%" indicator
- If < 80%: red banner "Auto-pause armed. Delivery rate has dropped below
  threshold. Review at [deliverability page]."

### 4. Auto-pause alert (in-app notification + email)

When a campaign auto-pauses due to canary threshold breach:

- In-app: notification toast + persistent banner on sequence page
- Email: sent to workspace admins with:
  > Your campaign "Q3 Enterprise Outbound" has been auto-paused.
  > Reason: deliverability to Proofpoint dropped to 43% (threshold: 80%).
  > Details: 8 canary sends in the last 2 hours, 3 arrived inbox, 5 silently dropped.
  > Review: [link] — either resume with a different mailbox, or investigate what changed.

## Mechanics — the provider-managed seed pool

**This is the operationally novel part of Phase 11.** Owning a pool of real
enterprise-SEG mailboxes is a legitimately hard operational lift. Here's how.

### The seed pool goal (concrete numbers)

For Deliverability Pro tier, Quiksend operates:

- **3 seed inboxes per major SEG × 4 SEGs = 12 mailboxes minimum**
  - Proofpoint: 3 seeds
  - Mimecast: 3 seeds
  - Barracuda: 3 seeds
  - Cisco Secure Email: 3 seeds
- **Optional expansion**: 1 seed each for Trend Micro, Fortinet, Sophos, Symantec
  (4 more mailboxes). Only if Pro tier data shows enough Pro customers whose lists
  hit those SEGs.
- **Redundancy**: 3 per SEG means we can lose one to auth-break or rate-limit and
  still have 2 giving signal.

### The pool build recipe (per SEG)

Each seed requires four things stacked:

1. **A domain** — buy from a registrar. Vary the domain profile so they don't look
   like an obvious "SEG canary" farm. Reasonable-sounding names: `apex-mail.net`,
   `nova-corp-mail.com`, `bright-office.co`. Register 3-6 months before use — some
   SEGs downgrade very-new domains.

2. **A mail hosting provider** — one of:
   - **Microsoft 365 Business Basic** ($6/user/mo) — best for the two SEGs that
     have deep M365 integration (Mimecast, Proofpoint's M365-optimized flow)
   - **Google Workspace Business Starter** ($7/user/mo) — for the other SEGs
   - The mailbox needs to be _live_ (receive some volume of real mail) before it
     looks legit to the SEG's reputation-tracking

3. **The SEG itself, subscribed and configured** — this is the non-trivial part:
   - **Proofpoint Essentials** — $2-5/user/mo, sold through partners. Business
     signup requires a domain and business info. Setup: point MX records to
     `mx1-usX.ppe-hosted.com`, verify domain, configure filtering rules.
   - **Mimecast** — free 30-day trial then $4-6/user/mo. Business signup. Setup:
     MX to `us-smtp-inbound-1.mimecast.com`, verify, configure policies.
   - **Barracuda Email Protection** — free 30-day trial, then $3-8/user/mo. Point
     MX to `mx.essentialscloud.com`, configure.
   - **Cisco Secure Email** — trial available, then $5-10/user/mo enterprise sold
     through partners. Point MX to `mx.iphmx.com`.

4. **Ongoing usage that makes the mailbox look legit** — real mail volume, not
   just canary sends. Options:
   - Subscribe to a handful of newsletters (5-10) so there's steady real inbound
   - Cross-send: seed A sends "hi" to seed B once a day (calendar invite pattern)
   - Include seeds in some internal Quiksend notifications (system status, weekly
     reports — real business-looking mail)
   - Manually reply to a portion of the canary sends occasionally (simulates human
     engagement)

### Total operational cost (rough)

Per SEG × 3 seeds × 4 SEGs = 12 seeds baseline.

Per seed: $6 (M365 or Google) + $2-5 (SEG subscription) + $1/mo (domain amortized) = **~$10/mo**.

**Total pool cost: ~$120/mo baseline; ~$200/mo with the 4-more-SEGs expansion.**

Add domain registration one-time (~$150 total for 12 domains at $12/year avg).

**Break-even math**: at $99/mo Pro tier, 3 subscribers cover the pool cost. 20+
subscribers = healthy margin. This is _not_ a moonshot — it's a viable line item.

### The seed pool tickets (11C.15 onward)

- **11C.15 — Domain acquisition + M365/GWS setup runbook**. Document in
  `internal-runbooks/seed-pool-setup.md`. Not shipped to public repo but tracked
  internally. First 12 domains purchased. First 12 mail accounts provisioned.
- **11C.16 — Per-SEG subscription + MX setup**. Runbook step-by-step for each SEG.
  Includes DNS record specs, verification screenshots (in an internal wiki, not
  the repo).
- **11C.17 — Seed inbox onboarding to the app**. Provider-managed seeds are
  inserted into `seed_inbox` with `organization_id = NULL` and `pool_tag =
'production'`. A one-time bootstrap script `scripts/seed-pool-bootstrap.ts`
  seeds the DB from the runbook's config.
- **11C.18 — Ongoing seed maintenance job**. Monthly cron
  `seed_pool.health_check`: for each seed, verify IMAP still connects, verify last
  30 days had non-canary mail (looks alive), alert if a seed has been dormant for
  60+ days (start of downgrade risk).
- **11C.19 — Legit-usage generator**. Weekly cron `seed_pool.generate_legit_mail`:
  cycles through seeds and generates mock internal-business-looking mail. Careful:
  this is at the boundary of SEG-cheating. Keep volume modest, content
  transactional-looking (invoice reminders, calendar invites), and vary
  send-times.

### The seed pool is a Quiksend business asset

The DB entries for provider-managed seeds live in the shared table with
`organization_id = NULL`. The IMAP credentials are encrypted with a **separate
system key** distinct from workspace-level `MAILBOX_ENCRYPTION_KEY` — because
workspace admins should never see these credentials, only Quiksend Systems. New env
var: `SYSTEM_SEED_ENCRYPTION_KEY`, only present in Quiksend Systems infra, not in
self-host builds. Self-hosters can still use Phase 11C's user-provided seeds; they
just don't get provider-managed access.

## Mechanics — canary injection

### When to inject canaries

The trigger point is **campaign launch** — specifically, `enrollProspects()`
server-fn in `sequences.functions.ts` (extended from Wave 5). When a bulk
enrollment happens:

1. Read workspace canary config + sequence canary config (sequence overrides).
2. Compute the SEG mix of the enrollment batch. If < N prospects behind any single
   SEG (default N = 5), skip canary injection for that SEG — not enough signal.
3. For each represented SEG with count >= N:
   - Pick `seedsPerCampaign` canary seed inboxes for that SEG (round-robin across
     eligible seeds — user's seeds for that SEG first, provider seeds as fallback
     if Pro).
   - Pick M random positions in the enrollment sequence to inject canary sends.
   - Create `canary_send` rows with `sent_at = NULL`, `expected_arrival_at = now
     - 15min`.
4. Enrollment proceeds normally. Each canary send is scheduled via the same
   `send_reservation` mechanism — treated identically to real sends by the engine.

### The canary send itself

The `canary_send` row is materialized into a real send at the scheduled position:

- Sender: one of the workspace's mailboxes (same rotation as real prospects would
  use).
- Recipient: the seed inbox's email.
- Content: **same body template as an adjacent real send in the campaign**, with:
  - `X-Quiksend-Canary-Id: <uuid canary_token>` header (Wave 4's `buildMime`
    extended)
  - Subject template with a small identifier appended: `<real subject> [Q7f3a2b8]`
    (the identifier is optional; helps human debugging but doesn't leak to
    recipient)

**Why "same body as adjacent real send":** SEGs analyze content. If canaries look
categorically different from real sends, they get filtered differently — invalidating
the signal. Use the actual sequence step's rendered content (with placeholder values
substituted for the seed's "identity" — first name = "Canary", etc.).

### Polling for arrival

`apps/worker/src/handlers/canary-check.ts` runs every 5 minutes (cron):

```typescript
async function handler(job: Job): Promise<void> {
  const dueCanaries = await db
    .select()
    .from(canary_send)
    .where(
      and(
        eq(canary_send.arrivalStatus, "pending"),
        lt(canary_send.expectedArrivalAt, sql`now() + interval '30 minutes'`),
        // Give up after 24h
        gt(canary_send.sentAt, sql`now() - interval '24 hours'`),
      ),
    );

  // Group by seed_inbox_id, one IMAP connection per seed
  const bySeed = groupBy(dueCanaries, "seedInboxId");

  await Promise.all(
    Object.entries(bySeed).map(async ([seedId, canaries]) => {
      await pollSeed(seedId, canaries);
    }),
  );

  // Sweep: any canary older than 24h that didn't arrive = silent_drop
  await db
    .update(canary_send)
    .set({ arrivalStatus: "silent_drop", arrivedAt: sql`now()` })
    .where(
      and(
        eq(canary_send.arrivalStatus, "pending"),
        lt(canary_send.sentAt, sql`now() - interval '24 hours'`),
      ),
    );

  // Update deliverability_snapshot rollup
  await refreshDeliverabilitySnapshots();

  // Check for pause thresholds
  await maybePauseCampaigns();
}
```

`pollSeed` connects to the seed's IMAP inbox, searches for messages by
`X-Quiksend-Canary-Id`, classifies arrival location:

- **Inbox folder** → `arrived_inbox`
- **Spam / Junk folder** → `arrived_spam`
- **Quarantine folder** (SEG-managed, varies by SEG) → `arrived_quarantine`
- **Not found after search of all folders** → still `pending` (may not have arrived
  yet) unless past 24h then `silent_drop`
- **Bounce message received** in inbox with matching canary id → `bounced`

Extract full `Authentication-Results` + `Received` chain from arrived messages —
stored in `canary_send.arrival_gateway_headers` for forensic detail (shown in the
UI drawer).

### Auto-pause logic

`maybePauseCampaigns()` runs after every poll cycle:

```typescript
async function maybePauseCampaigns() {
  // For each active sequence, compute rolling 2h canary delivery rate per SEG
  const stats = await db.execute(sql`
    SELECT enrollment.sequence_id, canary_send.mailbox_id, seed_inbox.gateway,
      count(*) FILTER (WHERE canary_send.arrival_status = 'arrived_inbox') AS delivered,
      count(*) AS total
    FROM canary_send
    JOIN seed_inbox ON seed_inbox.id = canary_send.seed_inbox_id
    JOIN enrollment ON enrollment.id = canary_send.enrollment_id -- if scoped
    WHERE canary_send.sent_at > now() - interval '2 hours'
      AND canary_send.arrival_status <> 'pending'
    GROUP BY enrollment.sequence_id, canary_send.mailbox_id, seed_inbox.gateway
    HAVING count(*) >= 3  -- need minimum 3 canaries for signal
  `);

  for (const row of stats) {
    const rate = row.delivered / row.total;
    const threshold = getSequenceThreshold(row.sequence_id); // default 80%
    if (rate < threshold) {
      await pauseSequence(row.sequence_id, {
        reason: "canary_deliverability_below_threshold",
        gateway: row.gateway,
        mailboxId: row.mailbox_id,
        deliverabilityPct: Math.round(rate * 100),
      });
    }
  }
}
```

Note: pausing a _sequence_ pauses all its enrollments. That's the current-state
behavior from Phase 5. Consider a finer-grained "pause only enrollments matching
this (mailbox, gateway) tuple" — deferred to 11C polish, easier to ship the
whole-sequence pause first.

### Seed inbox rotation + rate-limiting the polls

- Each seed inbox is polled every 5 minutes as long as it has pending canaries.
- If a seed has no pending canaries: poll every 30 minutes (heartbeat + IMAP
  connection sanity check).
- IMAP connections are pooled per seed (persistent, closed after 15min idle). Max
  concurrent connections capped at 20 to avoid overloading a single provider's
  IMAP endpoint.
- Gmail/M365 IMAP have per-app rate limits — Quiksend's poll rate stays well
  under those.

## Tickets (11C)

### Backend / worker

11C.1 — **Migration**: new tables `seed_inbox`, `canary_send`,
`deliverability_snapshot`. New enums.

11C.2 — **Seed inbox CRUD server-fns** + admin gates + credentials encryption.

11C.3 — **Seed inbox IMAP verification worker handler** — `seed_inbox.verify`,
enqueued on create.

11C.4 — **Canary injection during `enrollProspects`** — extends the existing
Wave-5 BETA enrollment path.

11C.5 — **`buildMime` extended** for `X-Quiksend-Canary-Id` header.

11C.6 — **`effects.ts:handleSendAuto`** extended to differentiate canary sends
(sent from same mailbox rotation but tracked distinctly, no CRM writeback, no
sequence state advance for the canary — it's a "shadow send").

11C.7 — **Canary polling worker** — `apps/worker/src/handlers/canary-check.ts`.

11C.8 — **Auto-pause logic** — extracted as `packages/core/src/deliverability/auto-pause.ts`
(pure evaluator, easily unit-tested), invoked from the worker after each poll.

11C.9 — **Deliverability snapshot refresh** — periodic rollup from `canary_send`
into `deliverability_snapshot`. Runs every 15 minutes.

11C.10 — **Server functions**: `getDeliverabilityGrid`, `getCanaryHistory`,
`getWorkspaceCanaryConfig`, `setWorkspaceCanaryConfig`. `isEntitledToProviderSeeds`

- `getProviderManagedSeedGateways`.

### UI

11C.11 — **Seed inbox settings page** — table + add modal + verify indicator.

11C.12 — **Deliverability grid page** — new route + query + polling.

11C.13 — **Sequence detail live indicator** — extend the deliverability outlook
panel with real-time updates.

11C.14 — **Auto-pause notifications** — in-app + email.

### Provider pool (operational)

11C.15 — **Runbook: Domain acquisition + M365/GWS setup**. (Internal doc; not in
public repo.)

11C.16 — **Runbook: per-SEG subscription setup**.

11C.17 — **Provider seed bootstrap** — `scripts/seed-pool-bootstrap.ts` +
`SYSTEM_SEED_ENCRYPTION_KEY` env config.

11C.18 — **Seed pool health check cron**.

11C.19 — **Legit-usage generator** — the "make the seed inboxes look real" cron.

### Testing (per Ticket)

- Unit tests per module (canary injection, arrival matching, auto-pause evaluator,
  seed pool crypto).
- Integration test: full lifecycle — create a seed inbox pointing to a Mailpit
  IMAP endpoint (or local Dovecot), inject a canary into a mock sequence, poll,
  detect arrival, update grid.
- Load test: 100 concurrent canaries across 5 seed inboxes, all arrive within 15
  minutes, grid updates in < 30s.
- Manual smoke: real Gmail seed inbox (owned by the developer), inject a canary
  via a real sequence, verify grid updates within 15 min.

## Risks & decisions (11C)

- **Seed inbox credentials are a security-critical asset**. Encryption at rest with
  a rotation-capable key (`MAILBOX_ENCRYPTION_KEY` and `SYSTEM_SEED_ENCRYPTION_KEY`
  are separate). IMAP passwords never in logs. Audit trail on every credential
  access via a new `seed_inbox_credential_access` event type.
- **Provider seed pool sabotage**. If a competitor discovers Quiksend's seed
  inboxes and injects specifically-designed sends, they could poison the
  deliverability signal (e.g. always-deliver test sends). Mitigation: rotate seed
  inboxes every 6-12 months, rotate domains, keep the exact list opaque. Not a
  strong defense; treat the pool as best-effort not perfectly-secure. Document.
- **IMAP polling costs money at scale**. If we grow to 100 Pro subscribers each
  with 20 canary sends per campaign per day, we're doing 2000 IMAP searches per 5
  minutes across 12 seeds. Fine at start; monitor at scale. Fallback: reduce poll
  frequency to 10 min after growing past N subscribers.
- **Silent drop misattribution**. If a canary doesn't arrive within 24h and we
  mark it `silent_drop`, but actually the seed's IMAP was down for 20 hours, we
  falsely flag a drop. Mitigation: track seed IMAP uptime, if seed was down
  during a canary's window, mark canary `undetermined` not `silent_drop`.
- **Provider-managed seed exhaustion**. If Pro grows past ~50 subscribers all
  sending to the same SEGs, our 3 seeds per SEG can't provide statistically
  meaningful signal per subscriber. Solution: as Pro grows, add more seeds per
  SEG (each additional seed ~$10/mo). Budget for this.
- **Canary body content matching real sends but with a "Canary" identity**. The
  seed's inbox will receive mail addressed to "Canary <email>". Recipients in
  those mailboxes are Quiksend Systems — nobody real. But the SEG doesn't know
  that, so it filters based on content signal. Works fine, but if a canary body
  contains something objectively spammy, the seed's inbox gets flagged over time.
  Document: canary bodies inherit the campaign's real body; if the campaign is
  spammy, the seed's reputation degrades. Users who abuse this by sending
  spam-classified content are throttled independently.

## Exit criteria (11C)

- All 11C.1–11C.14 tickets shipped (backend + UI). 11C.15–11C.19 tickets
  operational.
- User story: user creates workspace, adds a user seed inbox pointing to a
  Mailpit-hosted mailbox, imports 10 prospects behind fake-Proofpoint domain,
  enrolls in a sequence with canary injection enabled (workspace config), watches
  a canary arrive within 5 min, sees grid update.
- Deliverability Pro entitlement gate works: paid workspace sees provider seeds
  in seed inbox list; free workspace sees a promotion banner.
- Auto-pause fires correctly: manually break one seed's inbox (simulate silent
  drop), verify canary sent to that seed → auto-pause after 3 canaries + threshold
  breach.
- Documentation: `docs/deliverability.md` extended with the canary section +
  user-seed setup + Pro tier explanation.

---

# Phase 11D — Cross-channel escape (DEFERRED)

## Status

**Deferred to Phase 12+.** Nango's LinkedIn provider is not viable for
send-as-user (LinkedIn's OAuth grants for message sending are enterprise-partner-
only as of 2026Q3). Cross-channel escape requires a different integration surface:

- **Option 1**: LinkedIn's official Marketing Solutions API (paid, hard to get
  access, targeted at ad platforms not outreach tools).
- **Option 2**: LinkedIn Sales Navigator API (also paid, message sending limited).
- **Option 3**: Browser automation via Browserbase (headless Chrome running the
  user's LinkedIn session). Highest reach, gray-area terms of service. Would
  require a completely new adapter category ("browser adapters") separate from
  IMAP/SMTP/Nango.

The Phase 12+ conversation about which option to pursue is a strategic product
decision (LinkedIn scale, terms of service risk appetite, engineering investment).
Reserve the entry condition schema slot `if_recipient_gateway_route_channel:
"linkedin"` for future compatibility but don't wire the delivery path yet.

## Placeholder scope (when picked up)

- Nango-alternative integration for LinkedIn message send + inbound polling
- New adapter category if browser-automation path chosen
- Route condition in `entry-conditions.ts`
- LinkedIn thread anchoring analogous to email `anchor_message_id`
- Sentiment classification on LinkedIn replies (extends BETA's classifier)

---

# Consolidated Migration Plan

Phase 11 adds:

- 3 new tables: `gateway_classification`, `seed_inbox`, `canary_send`,
  `deliverability_snapshot`
- Column additions to `prospect`, `mailbox`, `sequence`
- 3 new enums: `gateway_type`, `canary_arrival_status`, `seed_inbox_pool_tag`

Migration numbering (assuming this ships against `v2.1.1`+ main):

- `0015_phase11a_gateway_classification.sql` — new table + prospect columns +
  new enum `gateway_type`
- `0016_phase11b_mailbox_enterprise_safe.sql` — mailbox column additions
- `0017_phase11c_canary_infrastructure.sql` — seed_inbox, canary_send,
  deliverability_snapshot, enums

Each is compatible with rollback (all additive; no destructive changes). Standard
rebase-renumber pattern if 11A/11B/11C ship in parallel worktrees.

---

# Testing Strategy (cross-phase)

- **CI green** at every phase merge. Standard `pnpm check` + engine load test.
- **Load test extensions** each add a new mode to `scripts/load-test-engine.ts`:
  - 11A: `--test-mode=gateway-detection`
  - 11B: `--test-mode=seg-routing`
  - 11C: `--test-mode=canary-happy-path` + `--test-mode=canary-auto-pause`
- **Manual smoke test** per phase exit criteria uses real DNS + real (self-hosted
  Dovecot or Mailpit-IMAP) mail path.
- **Integration test coverage** for each ticket in each phase.
- **Tenancy test extension**: `deliverability-tenancy.test.ts` — org A cannot see
  org B's seed inboxes, canary sends, or grid data. Provider-managed seeds visible
  to any Pro-tier workspace (that's the point).

---

# Rollout & Feature Flags

Each sub-phase ships behind a workspace-level feature flag stored in
`organization.metadata.features`:

- `feature.gateway_detection` (11A) — default on for all workspaces at 11A ship
- `feature.seg_routing_policy` (11B) — default off; user opts in
- `feature.canary_deliverability` (11C) — default off; user opts in
- `feature.deliverability_pro` (11C paid tier) — default off; billing-gated

The flags let ops disable a feature for a specific workspace if problems emerge
without a hotfix ship. Wave 7+ can extend the flag system further.

---

# Success Metrics

Instrument these into `event` inserts + analytics dashboards:

- **11A adoption**: % of workspaces with ≥1 SEG-tagged prospect (target: 60%
  within 30 days of ship — most enterprise lists have SEG exposure)
- **11A signal**: median % of prospects-per-workspace classified as non-`unknown`
  (target: 90%+)
- **11B activation**: % of workspaces that toggle routing policy to `warn` or
  `enforce` after 11B ships (target: 30% within 60 days)
- **11B save**: for enforce-mode workspaces, count of enrollments skipped by
  routing guard (this is the "money not lit on fire" metric)
- **11C activation**: % of workspaces that add ≥1 seed inbox (free tier signal)
- **11C Pro conversion**: % of workspaces on Pro after 11C's Pro banners surface
- **11C auto-pause save**: count of campaigns auto-paused. This is directly
  monetary — averaged send rate × canary-detected drop rate × campaign duration
  = money saved.

Dashboard: `_protected/analytics/deliverability.tsx` (extension of Wave 6
analytics page) shows all six metrics live.

---

# Open Questions (to resolve before or during implementation)

1. **DoH fallback** for MX lookups: worth building in 11A or defer to 11B follow-up
   when we see actual DNS reliability numbers? Recommendation: defer.
2. **Sequence-level canary threshold override** exposed in UI or admin-only? If
   exposed, add validation to prevent user setting 0% threshold (effectively off)
   or 100% (never triggers). Recommendation: admin-only initially.
3. **Deliverability grid update transport**: 30-second polling vs SSE vs
   WebSocket. Polling ships now; SSE later if UX demands it. Recommendation: poll.
4. **Provider-managed seed onboarding UX for new SEGs**: adding a 5th or 6th SEG
   to the pool takes ~2 weeks of ops work. Decision needed: which additional SEGs
   to target first based on Pro-tier data. Defer to post-11C launch.
5. **Content sanitizer opt-out granularity**: workspace-level, sequence-level, or
   step-level? Recommendation: workspace + sequence, not per-step.
6. **Auto-pause resume**: when a paused campaign has deliverability recovered
   (e.g. user swapped mailbox), does it auto-resume or stay paused pending user
   confirmation? Recommendation: **stay paused, require user confirmation**.
   Rationale: auto-resume risks flapping. User confirmation is one click.

---

# Estimated Effort

- **Phase 11A**: 2-3 days (1 agent)
- **Phase 11B**: 3-4 days (1 agent)
- **Phase 11C backend**: 1 week (1 agent)
- **Phase 11C UI**: 3-4 days (1 agent, in parallel with backend)
- **Phase 11C seed pool operational setup**: 1-2 weeks calendar time (domain
  purchases, SEG signups, DNS propagation, verification loops). Can start
  before code.

**Total calendar time for full Phase 11**: 3-4 weeks with 1-2 agents at a time,
plus the operational setup running in parallel.

**Serial dependencies**: 11B needs 11A (routing depends on classification). 11C
canary polling can start once 11A ships (seed inboxes can be created without
routing). Full 11C only makes sense after 11B routing is live (otherwise the
canary tells you what you already know from silent drops).

---

# Grounding artifact map

Phase 11 attaches to these specific Waves-1-6 artifacts:

- `packages/mail/src/dns.ts` (Phase 4) — extend with MX resolution
- `packages/mail/src/mime.ts` (Phase 4) — extend with canary token header
- `packages/mail/src/adapters/index.ts` (Phase 4 + Wave 5 CR-009) — content
  sanitizer inserted here
- `packages/core/src/state-machine/entry-conditions.ts` (Wave 5 BETA) — extended
  with 2 new predicate fields
- `packages/core/src/state-machine/transition.ts` (Phase 5) — new events
- `apps/worker/src/sequence/reserve-slot.ts` (Wave 5 ALPHA CR-005) — extended with
  gateway-aware routing + SEG throttle
- `apps/worker/src/sequence/effects.ts` (Wave 5 ALPHA CR-004) — extended with
  canary send handling
- `apps/worker/src/handlers/mailbox-poll.ts` (Wave 5 DELTA CR-012) — pattern for
  canary polling
- `apps/web/src/lib/effect-executor.ts` (Wave 6 OMEGA ARCH-002) — extended for
  new effect kinds
- `apps/web/src/lib/analytics.functions.ts` (Wave 6 OMEGA PERF-010) —
  `withAnalyticsTiming` wrapper reused for all Phase 11 read paths
- `apps/web/src/lib/inbox.functions.ts` (Wave 6 OMEGA PERF-012) — `DISTINCT ON`
  pattern reused for grid queries
- `sequence_stats` view (Phase 9 + Wave 6 PERF-008) — extended with
  `by_gateway` breakdowns

Nothing in Phase 11 requires new architectural primitives. The engine, adapter
system, effect executor, state machine, and analytics infrastructure are all
already extension-ready as a direct result of the review-driven refactors in Waves
5 and 6.
