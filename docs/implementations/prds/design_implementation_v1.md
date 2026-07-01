# Quiksend — Open-Source Sales Engagement Platform

### PRD, Architecture & Design, and MVP/V0 Implementation Plan

> **Working codename:** _Quiksend_.
> **One-line:** An open-source, self-hostable alternative to Outreach.io and Salesforge.ai — AI-personalized email sequences with first-class CRM operations, built for builders who want to own their stack.
> **Stack (fixed by spec):** TypeScript · pnpm workspaces · TanStack Start · Better Auth · Nango.dev · PostgreSQL + Drizzle.
> **Doc status:** V0 build spec. Sources for framework APIs verified against current docs (TanStack Start, Better Auth, Nango) and current competitor feature sets (Salesforge, Outreach) as of June 2026.

---

## Table of Contents

1. [Vision & Goals](#1-vision--goals)
2. [Competitive Analysis & Feature Distillation](#2-competitive-analysis--feature-distillation)
3. [MVP/V0 Scope (In / Out)](#3-mvpv0-scope-in--out)
4. [Product Requirements (PRD)](#4-product-requirements-prd)
5. [System Architecture](#5-system-architecture)
6. [Data Model (Drizzle / Postgres)](#6-data-model-drizzle--postgres)
7. [Auth & Multi-Tenancy (Better Auth)](#7-auth--multi-tenancy-better-auth)
8. [The Sequence Engine (core)](#8-the-sequence-engine-core)
9. [Email Sending & Mailbox Layer](#9-email-sending--mailbox-layer)
10. [Reply, Bounce & Unified Inbox](#10-reply-bounce--unified-inbox-primebox)
11. [AI Research & Generation Pipeline](#11-ai-research--generation-pipeline)
12. [CRM Integrations (Nango: Salesforce + HubSpot)](#12-crm-integrations-nango-salesforce--hubspot)
13. [API & Server-Function Design (TanStack Start)](#13-api--server-function-design-tanstack-start)
14. [Deliverability, Compliance & Non-Functional](#14-deliverability-compliance--non-functional-requirements)
15. [Implementation Plan (phased, ticketed)](#15-implementation-plan-phased--ticketed)
16. [Definition of Done for V0](#16-definition-of-done-for-v0)
17. [Risks & Open Questions](#17-risks--open-questions)

---

## 1. Vision & Goals

**Problem.** Outreach and Salesforge are powerful but closed, seat/mailbox-priced, and opaque. Teams that already own data infrastructure (or care about cost, privacy, and extensibility) have no credible self-hostable option that combines _(a)_ real sequence automation, _(b)_ genuinely good AI personalization grounded in live research, and _(c)_ native two-way CRM operations.

**Quiksend's thesis.** Be the "Supabase of sales engagement": an open-source core that nails the three hard things — the **sequence state machine**, **deliverability-aware sending**, and **research-grounded AI generation** — with CRM integration as a first-class citizen rather than a bolt-on.

**V0 success criteria (the three must-haves from the brief):**

1. **Manual-first → auto-follow-up.** A user writes and sends a _manual_ first email, then enrolls that prospect (and that exact thread) into an automated follow-up sequence whose steps thread under the original email.
2. **Research-grounded AI generation.** Generate emails using up-to-date researched info on the prospect, their company, and a mapping of the sender's value proposition to that prospect.
3. **CRM ops via Nango.** Connect, read, and write back to Salesforce and HubSpot through Nango-managed integrations.

**Design principles.**

- _Own the engine, rent the edges._ We build the sequence engine, sending layer, and AI pipeline; we delegate OAuth/token lifecycle to Nango and auth to Better Auth.
- _Deliverability is a feature, not an afterthought._ Throttling, rotation, threading, suppression, and unsubscribe are core, not "pro tier."
- _Human-in-the-loop by default._ AI drafts; humans approve (especially the first touch). Autopilot is a later, opt-in capability.
- _Multi-tenant from line one._ Every row is scoped to an organization (workspace).

---

## 2. Competitive Analysis & Feature Distillation

The goal here is not to clone either product but to extract the features that actually drive replies and pipeline, then decide what belongs in V0.

### Outreach.io (the enterprise "sales engagement" incumbent)

- **Sequences** (their term for multi-step cadences) across email + calls + LinkedIn + manual tasks, with branching/conditions.
- **Sales engagement workflow**: tasks, reminders, "do this next" queues for reps.
- **Deep CRM sync** (Salesforce-first, bi-directional), activity logging, deal/opportunity context.
- **Dialer + conversation intelligence** (call recording, transcription, AI summaries).
- **Analytics**: sequence performance, A/B testing, team reporting, deal health.
- **Mutual action plans / deal management** (higher-tier).

### Salesforge.ai (the AI-native, high-volume "Forge stack")

- **AI personalization at scale** — emails generated against prospect/company/role context, in 20+ languages; positioned as the differentiator vs. template-only tools.
- **Multichannel sequences** (email + LinkedIn) from one dashboard, with conditional steps and A/B testing.
- **Unlimited mailboxes + mailbox rotation** ("smart rotation" to spread send volume and protect reputation), no per-mailbox pricing.
- **Warmforge** — built-in warm-up pool to build sender reputation; heat-score targets, ESP matching.
- **Primebox** — unified inbox consolidating replies across all mailboxes _and_ LinkedIn, including replies from a different address, with AI sentiment/triage.
- **Agent Frank** — autonomous AI SDR that researches, writes, sequences, follows up, and books meetings (add-on).
- **Forge stack infra** (Mailforge/Primeforge/Infraforge) — domain + mailbox provisioning with auto SPF/DKIM/DMARC; Leadsforge for lead search.
- **Spintax** for copy variation, inbox-placement testing, blacklist checks.
- **CRM + tool integrations**: HubSpot, Salesforce, Pipedrive, Attio, Clay, Slack, Zapier, webhooks, public API, MCP server.

### Feature distillation → priority buckets

| Feature                                                 | Drives replies? | V0?                           | Notes                                                      |
| ------------------------------------------------------- | --------------- | ----------------------------- | ---------------------------------------------------------- |
| Multi-step email sequences w/ delays & conditions       | ★★★             | **Yes**                       | Core.                                                      |
| Manual first email → auto follow-up in same thread      | ★★★             | **Yes**                       | Explicit must-have; key UX.                                |
| AI generation grounded in live research                 | ★★★             | **Yes**                       | Explicit must-have; the differentiator.                    |
| Two-way Salesforce + HubSpot (Nango)                    | ★★★             | **Yes**                       | Explicit must-have.                                        |
| Unified inbox (reply consolidation)                     | ★★★             | **Yes**                       | Stop-on-reply requires reply detection anyway; surface it. |
| Sending throttle + sending windows + timezone           | ★★★             | **Yes**                       | Deliverability table stakes.                               |
| Mailbox rotation across connected accounts              | ★★☆             | **Yes (basic)**               | Round-robin within a sequence.                             |
| Suppression list + unsubscribe + bounce handling        | ★★★             | **Yes**                       | Compliance + reputation.                                   |
| A/B variants on a step                                  | ★★☆             | **Yes (lite)**                | 2 variants, even split, basic stats.                       |
| Open/click tracking                                     | ★☆☆             | **Optional (off by default)** | Hurts deliverability; honest caveat.                       |
| Analytics dashboard (sends/replies/bounces by sequence) | ★★☆             | **Yes (basic)**               | Funnel + per-step rates.                                   |
| Public API + API keys                                   | ★★☆             | **Yes**                       | Better Auth apiKey plugin makes this cheap.                |
| Deliverability checks (SPF/DKIM/DMARC)                  | ★★☆             | **Yes (read-only check)**     | Provisioning is out; checking is in.                       |
| LinkedIn channel                                        | ★★☆             | **No (fast-follow)**          | Sequence model designed to accommodate it.                 |
| Autonomous AI SDR ("Agent Frank")                       | ★★☆             | **No (fast-follow)**          | V0 is human-in-the-loop.                                   |
| Warm-up pool                                            | ★★☆             | **No (fast-follow)**          | Significant subsystem; document interface.                 |
| Dialer / conversation intelligence                      | ★☆☆             | **No**                        | Out of scope.                                              |
| Infra/mailbox provisioning (Mailforge-style)            | ★☆☆             | **No**                        | BYO mailbox in V0.                                         |

---

## 3. MVP/V0 Scope (In / Out)

**In scope (V0):**

- Email/password + Google/Microsoft social login; multi-tenant **workspaces** (orgs), roles, invitations.
- **Mailbox connection** via OAuth (Gmail, Microsoft 365) and generic SMTP/IMAP, all through Nango where possible.
- **Prospects & companies**: CSV import, manual add, CRM-sourced lists; custom fields.
- **CRM**: connect Salesforce + HubSpot via Nango; inbound contact/account sync; outbound activity logging + contact create/update + status write-back.
- **Sequences**: steps of type `manual_email`, `auto_email`, `wait`, `task`; per-step delays; basic conditions; A/B (2 variants); sending window + timezone + per-mailbox daily cap + inter-send throttle; mailbox round-robin.
- **Manual-first flow**: compose/send first email (optionally AI-assisted) → enroll prospect + anchor thread into a follow-up sequence.
- **Sequence engine**: durable worker, enrollment state machine, stop-on-reply/bounce/unsubscribe.
- **Unified inbox** ("Primebox"-style): inbound reply detection + threading + manual reply.
- **AI**: research pipeline (CRM + web) → research profile → grounded generation w/ value-prop mapping → human review → humanization/spintax.
- **Deliverability/compliance**: suppression list, unsubscribe link + handling, bounce handling, SPF/DKIM/DMARC checker.
- **Analytics**: per-sequence + per-step funnel.
- **Public REST API** + API keys + outbound webhooks.

**Out of scope (V0 — documented as fast-follow):**

- LinkedIn channel and any non-email channel.
- Autonomous AI SDR (full autopilot).
- Warm-up pool / mailbox + domain provisioning.
- Dialer, call recording, conversation intelligence.
- Advanced deal/opportunity management & mutual action plans.

---

## 4. Product Requirements (PRD)

User stories grouped by epic. Each has acceptance criteria (AC).

### Epic A — Accounts, Workspaces, Members

- **A1.** As a user I can sign up (email/password or Google/Microsoft) and land in a default workspace.
  - AC: session persists across reload; protected routes redirect unauthenticated users.
- **A2.** As an owner I can create additional workspaces and invite members with roles (owner/admin/member).
  - AC: invitations by email; accepting joins the workspace; all data is scoped to the active workspace.
- **A3.** As a user I can switch active workspace; all lists/sequences/inbox reflect the active workspace only.

### Epic B — Mailboxes

- **B1.** As a member I can connect a sending mailbox (Gmail / Microsoft 365 via OAuth, or SMTP/IMAP).
  - AC: connection status visible; test-send works; tokens are never exposed client-side.
- **B2.** As a member I can set per-mailbox sending settings: daily cap, sending window (per weekday), timezone, min gap between sends, signature, and "from name."
- **B3.** As a member I can see mailbox health flags (SPF/DKIM/DMARC pass/fail, recent bounce rate).

### Epic C — Prospects & Companies

- **C1.** Import prospects by CSV with column mapping (email, first/last name, company, title, custom fields).
  - AC: dedupe by email within workspace; invalid emails flagged.
- **C2.** Pull prospects/accounts from a connected CRM into a list.
- **C3.** View a prospect record: fields, CRM links, research profile, sequence history, message timeline.

### Epic D — Sequences

- **D1.** Build a sequence as an ordered list of steps; each step is `manual_email | auto_email | wait | task`.
- **D2.** Per `*_email` step: subject, body (with variables + snippets), optional A/B variant B, optional "AI-generate at send time" flag.
- **D3.** Per step: delay relative to previous step (days/hours/business-days), and optional condition (e.g., "only if no reply").
- **D4.** Sequence settings: sending window, timezone, throttle, mailbox(es) to rotate across, stop conditions.
- **D5.** Enroll one or many prospects; choose sending mailbox(es); preview the schedule.
  - AC: enrollment shows computed `nextRunAt` per step; can pause/resume/stop per enrollment or per prospect.

### Epic E — Manual-first → Auto follow-up (flagship flow)

- **E1.** Compose a one-off email to a prospect from a chosen mailbox (AI-assist optional). On send, Quiksend captures the **thread anchor** (Message-ID, thread id, mailbox).
- **E2.** Immediately (or later) enroll that prospect into a **follow-up sequence**. Follow-up steps thread under the anchor: subject becomes `Re: <original>`, headers `In-Reply-To`/`References` set to the anchor, same mailbox.
  - AC: timing of follow-ups is relative to the manual send time; replies on the thread stop the sequence.
- **E3.** Alternative entry: select an already-sent email (from the inbox/timeline) and "Start follow-up sequence from this email."
- **E4.** A sequence may itself begin with a `manual_email` step; the engine creates a compose task and waits for the user to send before scheduling subsequent steps.

### Epic F — AI Research & Generation

- **F1.** Maintain a workspace **Value Proposition Library**: products, positioning, proof points/case studies, ICP notes.
- **F2.** For a prospect, generate/refresh a **Research Profile**: facts about the prospect + company from CRM and live web research, with sources and a freshness timestamp.
- **F3.** Generate an email (subject + body) grounded in the research profile + value-prop mapping; output includes a short "why this angle" rationale and the sources used.
  - AC: generation is model-agnostic; human can edit before send; spintax/humanization pass available; spammy-phrase linting surfaced.
- **F4.** Optionally generate an A/B variant.

### Epic G — Inbox & Replies

- **G1.** Detect inbound replies across connected mailboxes; thread them; show a unified inbox.
- **G2.** A reply on an active enrollment's thread stops that enrollment (configurable) and flags it for human handling.
- **G3.** Reply from the inbox (same thread, same mailbox); optional AI-suggested reply.
- **G4.** Basic sentiment/triage tag on inbound (interested / not now / objection / out-of-office / unsubscribe).

### Epic H — CRM Write-back

- **H1.** Log every sent email and reply as an activity on the matching CRM contact (Salesforce Task / HubSpot Engagement).
- **H2.** Create/update CRM contact when a new prospect is added; map fields per workspace config.
- **H3.** Update a CRM status/property on key events (replied, meeting booked, unsubscribed).

### Epic I — Compliance & Deliverability

- **I1.** Global + per-workspace **suppression list**; never send to suppressed/unsubscribed/hard-bounced addresses.
- **I2.** Unsubscribe link injected (configurable) + footer with physical address; clicks add to suppression and (optionally) write back to CRM.
- **I3.** Bounce detection updates prospect status and suppression.
- **I4.** SPF/DKIM/DMARC checker per sending domain with pass/fail + remediation hints.

### Epic J — Analytics

- **J1.** Per-sequence funnel: enrolled → sent → delivered → opened (if enabled) → replied → bounced → unsubscribed.
- **J2.** Per-step rates and A/B comparison.
- **J3.** Per-mailbox volume vs. cap, bounce rate trend.

### Epic K — API & Webhooks

- **K1.** API keys (scoped per workspace) to create prospects, enroll into sequences, read analytics.
- **K2.** Outbound webhooks on events (`message.sent`, `reply.received`, `enrollment.finished`, `prospect.unsubscribed`).

---

## 5. System Architecture

### 5.1 High-level

```
                       ┌──────────────────────────────────────────────┐
                       │                  apps/web                     │
   Browser ◀──SSR────▶ │  TanStack Start (React + Router + Query)       │
                       │  • Server functions (createServerFn)          │
                       │  • Server routes (createFileRoute server.*)    │
                       │    - /api/auth/*      (Better Auth handler)    │
                       │    - /api/nango/webhook                        │
                       │    - /api/mail/webhook (Gmail/Graph push)      │
                       │    - /api/track/*     (open/click, optional)   │
                       │    - /api/v1/*        (public REST API)        │
                       └───────────────┬──────────────────────────────┘
                                       │ shared packages (db, core, ai, email, integrations)
                                       ▼
                       ┌──────────────────────────────────────────────┐
                       │                 PostgreSQL                    │
                       │  (Drizzle schema — single source of truth)     │
                       └───────────────▲──────────────────────────────┘
                                       │
                       ┌───────────────┴──────────────────────────────┐
                       │                 apps/worker                   │
                       │  Long-running Node process(es):               │
                       │  • Scheduler tick (claim due enrollments)     │
                       │  • Send executor (mailbox adapters)           │
                       │  • Reply/bounce poller                        │
                       │  • Research/generation jobs                   │
                       │  • CRM sync/write-back runners                │
                       │  Job queue: pg-boss (Postgres-backed)         │
                       └───────────────┬──────────────────────────────┘
                                       │
        ┌──────────────┬──────────────┼───────────────┬───────────────┐
        ▼              ▼              ▼               ▼               ▼
   Gmail API /    Nango (OAuth +   AI provider     Web research    Webhooks out
   MS Graph /     proxy + syncs +  (model-agnostic  (search +       (HMAC-signed)
   SMTP/IMAP      actions) ⇄ SF/HS  via AI SDK)      fetch/enrich)
```

**Why a separate worker process.** The sequence engine is time-driven and long-running; it must not live in the request lifecycle. `apps/web` handles UI + API; `apps/worker` runs the scheduler and executors. Both import the same `packages/*` and talk to the same Postgres. This split also lets you scale senders independently and run the worker on Beckett's home Ubuntu/Docker box while the web app sits elsewhere.

### 5.2 Monorepo layout (pnpm workspaces)

```
Quiksend/
├─ apps/
│  ├─ web/                 # TanStack Start app (UI + server fns + server routes)
│  └─ worker/              # scheduler, send executor, pollers, sync runners
├─ packages/
│  ├─ db/                  # Drizzle schema, client, migrations
│  ├─ auth/                # Better Auth server config (shared by web + worker + api)
│  ├─ core/                # domain types + sequence engine + enrollment state machine
│  ├─ email/               # mailbox adapters (gmail/graph/smtp), react-email, tracking, MIME/threading
│  ├─ ai/                  # research + generation pipeline, provider adapters, humanizer
│  ├─ integrations/        # Nango client wrapper, SF/HS field mappers, sync/action defs
│  └─ config/              # zod-validated env, constants, logger
├─ nango-integrations/     # (optional) custom Nango sync/action source
├─ pnpm-workspace.yaml
├─ turbo.json              # task orchestration (build/typecheck/test/lint)
└─ package.json
```

### 5.3 Technology choices (and rationale)

| Concern              | Choice                                                              | Why                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-stack framework | **TanStack Start**                                                  | Spec'd. SSR + typed file routing + `createServerFn` RPC + server routes for webhooks/API.                                                                                                                                                                                                                                                                                |
| Auth                 | **Better Auth**                                                     | Spec'd. `organization` plugin = multi-tenant workspaces; `apiKey` plugin = public API; Drizzle adapter.                                                                                                                                                                                                                                                                  |
| DB                   | **PostgreSQL** (locked)                                             | Relational fit for enrollments/messages; `FOR UPDATE SKIP LOCKED` for safe multi-worker claiming; JSONB for custom fields/research; `pgvector` for AI features later. Chosen over SQLite/Turso to avoid a dialect migration if Quiksend grows past single-worker. Use a managed PG (Neon/Supabase/DO) or self-host on the Ubuntu box — ops cost is near-zero either way. |
| ORM                  | **Drizzle**                                                         | TS-native, first-class Better Auth adapter, typed migrations.                                                                                                                                                                                                                                                                                                            |
| Integrations         | **Nango.dev**                                                       | Spec'd. Managed OAuth + token refresh + proxy + syncs/actions for SF/HS (and Google/Microsoft mailbox OAuth).                                                                                                                                                                                                                                                            |
| Job queue/scheduler  | **pg-boss**                                                         | Postgres-backed (no extra infra), cron + retries + dead-letter; matches "own your stack." _Alt: Graphile Worker, or Inngest/Trigger.dev for durable step-workflows if you prefer hosted orchestration._                                                                                                                                                                  |
| Email templating     | **react-email**                                                     | Type-safe templates, good HTML output.                                                                                                                                                                                                                                                                                                                                   |
| AI                   | **Vercel AI SDK (`ai`)**                                            | Provider-agnostic (Anthropic/OpenAI/etc.), tool-calling + structured outputs via Zod.                                                                                                                                                                                                                                                                                    |
| Web research         | **Pluggable** (Exa/Tavily/Brave + fetch-and-summarize)              | Keep the provider behind an interface; default to one search + site fetch.                                                                                                                                                                                                                                                                                               |
| Validation           | **Zod**                                                             | Shared between server-fn validators, Nango sync models, env, and AI structured outputs.                                                                                                                                                                                                                                                                                  |
| UI                   | **shadcn/ui** (Radix + Tailwind) + **TanStack Table** + **dnd-kit** | Copy-in components you own; zero-runtime styling = no CSS-in-JS hydration cost under SSR; Radix accessibility; matches your existing Tailwind/shadcn builds. Table + dnd-kit cover the data-grid and sequence-builder surfaces. See §5.4.                                                                                                                                |
| Errors/observability | **Sentry + PostHog**                                                | You already run both; structured logs via pino.                                                                                                                                                                                                                                                                                                                          |

### 5.4 UI component system (shadcn/ui)

**Decision: shadcn/ui (Radix primitives + Tailwind), composed with TanStack Table for data grids and dnd-kit for the sequence builder.**

Quiksend is component-dense — a drag-and-drop sequence builder, several data tables (prospects, sequences, analytics), a unified inbox, and many validated forms/settings. Re-implementing accessible dialogs, popovers, comboboxes, toasts, and focus management is undifferentiated work that's easy to get subtly wrong, so a library is worth it. The _copy-in_ kind (shadcn) is chosen over runtime-CSS-in-JS kits (MUI/Chakra) and batteries-included alternatives (Mantine/Ant) for three reasons:

- **SSR fit.** TanStack Start renders on the server. Tailwind + Radix are zero-runtime styling, so there's no Emotion-style hydration cost or first-paint flicker.
- **Ownership.** shadcn copies component source into the repo rather than installing a black box — which matters precisely for the bespoke surfaces (sequence builder, inbox) that _are_ the product.
- **Consistency.** Same Tailwind/shadcn mental model as your other builds; the `frontend-design` skill applies for the aesthetic layer.

_(Mantine is the strongest alternative and would be faster for a generic CRUD admin, but its styling system sits outside Tailwind and Quiksend's highest-value screens want maximal customization over out-of-the-box widgets.)_

**How to wire it:**

- Initialize shadcn against the Vite/TanStack Start setup (follow the current CLI flags — they drift): generates `components.json`, Tailwind config, and the `cn()` helper. Add components à la carte per screen rather than all at once.
- **Theming:** CSS variables in OKLCH with light/dark tokens, so the whole system retints from one token file.
- **Data grids:** compose **TanStack Table** (headless) with shadcn table primitives for prospects, sequence lists, analytics, and the inbox — sorting/filtering/pagination/virtualization, and it slots into the TanStack ecosystem already in use.
- **Sequence builder:** **dnd-kit** for drag-and-drop step reordering.
- **Forms:** react-hook-form + the existing Zod schemas (shared with server-fn validators) via `@hookform/resolvers`, rendered with shadcn `Form` components.
- Lives in `packages/ui` (shared primitives/theme) consumed by `apps/web`; app-specific composite components stay in `apps/web`.

---

## 6. Data Model (Drizzle / Postgres)

Better Auth owns its tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `apikey`). Application tables below are all scoped by `organization_id`. Abbreviated; types illustrative.

```ts
// packages/db/schema/app.ts  (illustrative)
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const orgId = () => text("organization_id").notNull(); // FK → organization.id

// ── Mailboxes ────────────────────────────────────────────────
export const provider = pgEnum("mailbox_provider", [
  "gmail",
  "microsoft",
  "smtp",
]);
export const mailbox = pgTable(
  "mailbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: orgId(),
    userId: text("user_id"), // owner
    provider: provider("provider").notNull(),
    emailAddress: text("email_address").notNull(),
    fromName: text("from_name"),
    nangoConnectionId: text("nango_connection_id"), // OAuth via Nango
    smtpConfig: jsonb("smtp_config"), // for provider=smtp (encrypted)
    dailyLimit: integer("daily_limit").default(50).notNull(),
    minGapSeconds: integer("min_gap_seconds").default(90).notNull(),
    sendingWindow: jsonb("sending_window"), // {tz, days:{mon:[9,17],...}}
    signatureHtml: text("signature_html"),
    status: text("status").default("active").notNull(),
    health: jsonb("health"), // {spf,dkim,dmarc,bounceRate}
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("mailbox_org_idx").on(t.organizationId)],
);

// ── Companies & Prospects ────────────────────────────────────
export const company = pgTable("company", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  name: text("name"),
  domain: text("domain"),
  crmRefs: jsonb("crm_refs"), // {salesforce:{id}, hubspot:{id}}
  enrichment: jsonb("enrichment"),
});

export const prospect = pgTable(
  "prospect",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: orgId(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    companyId: uuid("company_id"),
    customFields: jsonb("custom_fields"),
    crmRefs: jsonb("crm_refs"),
    status: text("status").default("active"), // active|replied|bounced|unsubscribed
    source: text("source"), // csv|crm|api|manual
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("prospect_org_email_idx").on(t.organizationId, t.email)],
);

// ── Sequences ────────────────────────────────────────────────
export const sequence = pgTable("sequence", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  name: text("name").notNull(),
  status: text("status").default("draft"), // draft|active|archived
  settings: jsonb("settings"), // {tz, throttle, mailboxIds[], stopOnReply}
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stepType = pgEnum("step_type", [
  "manual_email",
  "auto_email",
  "wait",
  "task",
]);
export const sequenceStep = pgTable("sequence_step", {
  id: uuid("id").defaultRandom().primaryKey(),
  sequenceId: uuid("sequence_id").notNull(),
  order: integer("order").notNull(),
  type: stepType("type").notNull(),
  delayMinutes: integer("delay_minutes").default(0).notNull(), // relative to prev step completion
  businessDaysOnly: boolean("business_days_only").default(true),
  condition: jsonb("condition"), // e.g. {ifNoReply:true}
  subject: text("subject"),
  bodyTemplate: text("body_template"), // variables + snippets
  variantB: jsonb("variant_b"), // {subject, bodyTemplate}
  aiGenerate: boolean("ai_generate").default(false),
});

// ── Enrollments (the state machine record) ───────────────────
export const enrollmentState = pgEnum("enrollment_state", [
  "pending",
  "active",
  "waiting_manual",
  "paused",
  "finished",
  "replied",
  "bounced",
  "unsubscribed",
  "failed",
]);
export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: orgId(),
    sequenceId: uuid("sequence_id").notNull(),
    prospectId: uuid("prospect_id").notNull(),
    mailboxId: uuid("mailbox_id").notNull(), // resolved at enroll (rotation)
    state: enrollmentState("state").default("pending").notNull(),
    currentStepOrder: integer("current_step_order").default(0).notNull(),
    nextRunAt: timestamp("next_run_at"),
    anchorMessageId: text("anchor_message_id"), // RFC Message-ID of manual first email
    anchorThreadId: text("anchor_thread_id"), // provider thread id
    enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
  },
  (t) => [
    index("enroll_due_idx").on(t.state, t.nextRunAt), // scheduler hot path
    index("enroll_prospect_idx").on(t.organizationId, t.prospectId),
  ],
);

// ── Messages (outbound + inbound) ────────────────────────────
export const direction = pgEnum("direction", ["outbound", "inbound"]);
export const message = pgTable(
  "message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: orgId(),
    enrollmentId: uuid("enrollment_id"),
    stepId: uuid("step_id"),
    prospectId: uuid("prospect_id"),
    mailboxId: uuid("mailbox_id").notNull(),
    direction: direction("direction").notNull(),
    threadId: text("thread_id"),
    providerMessageId: text("provider_message_id"), // RFC Message-ID
    inReplyTo: text("in_reply_to"),
    subject: text("subject"),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    status: text("status"), // scheduled|sent|delivered|bounced|opened|clicked|replied|failed
    sentiment: text("sentiment"), // inbound triage
    scheduledAt: timestamp("scheduled_at"),
    sentAt: timestamp("sent_at"),
    idempotencyKey: text("idempotency_key"), // unique(enrollment, step, attempt)
  },
  (t) => [
    index("message_thread_idx").on(t.threadId),
    index("message_prospect_idx").on(t.organizationId, t.prospectId),
  ],
);

// ── Research, value-prop, suppression, events, crm ───────────
export const researchProfile = pgTable("research_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  prospectId: uuid("prospect_id"),
  companyId: uuid("company_id"),
  facts: jsonb("facts"), // [{claim, source, confidence}]
  sources: jsonb("sources"),
  freshAt: timestamp("fresh_at"),
});

export const valueProp = pgTable("value_prop", {
  // workspace positioning library
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  product: text("product"),
  positioning: text("positioning"),
  proofPoints: jsonb("proof_points"),
  icpNotes: text("icp_notes"),
});

export const suppression = pgTable(
  "suppression",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: orgId(),
    email: text("email").notNull(),
    reason: text("reason"), // unsubscribed|bounced|manual|complaint
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("suppression_org_email_idx").on(t.organizationId, t.email)],
);

export const event = pgTable("event", {
  // analytics + webhooks source
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmConnection = pgTable("crm_connection", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: orgId(),
  providerConfigKey: text("provider_config_key").notNull(), // Nango integration id (e.g. "salesforce")
  nangoConnectionId: text("nango_connection_id").notNull(),
  fieldMapping: jsonb("field_mapping"),
  status: text("status").default("active"),
});
```

**Indexing for the scheduler:** the hot query is "claim active enrollments where `next_run_at <= now()`," so `enroll_due_idx(state, next_run_at)` plus `... FOR UPDATE SKIP LOCKED` is the backbone of safe concurrency.

---

## 7. Auth & Multi-Tenancy (Better Auth)

Single shared config in `packages/auth`, consumed by web, worker, and API.

```ts
// packages/auth/index.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, apiKey } from "better-auth/plugins";
import { db } from "@Quiksend/db";
import * as schema from "@Quiksend/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    microsoft: {
      clientId: process.env.MS_CLIENT_ID!,
      clientSecret: process.env.MS_CLIENT_SECRET!,
    },
  },
  plugins: [
    organization(), // workspaces, members, roles, invitations, activeOrganizationId on session
    apiKey(), // public API keys (scoped, hashed)
  ],
});
```

**Mounting in TanStack Start** (server route catch-all):

```ts
// apps/web/src/routes/api/auth/$.ts
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@Quiksend/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
```

**Server-side session + tenant guard** (reusable middleware for server functions):

```ts
// apps/web/src/lib/auth-mw.ts
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@Quiksend/auth";

export const authMiddleware = createMiddleware().server(async ({ next }) => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) throw new Error("UNAUTHORIZED");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("NO_ACTIVE_WORKSPACE");
  return next({ context: { user: session.user, orgId } });
});

// Every data-touching server fn composes this and scopes queries by ctx.orgId.
export const listSequences = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    db.query.sequence.findMany({
      where: (s, { eq }) => eq(s.organizationId, context.orgId),
    }),
  );
```

**Tenancy rule (enforced, not assumed):** no application query runs without an `organizationId` predicate. Add a Drizzle helper `scoped(orgId)` and a lint/test that fails CI if an app table is queried without it. (Optionally enable Postgres RLS as defense-in-depth in a later phase.)

---

## 8. The Sequence Engine (core)

This is the heart of the system. It is a **per-enrollment state machine** driven by a **scheduler tick** + **job queue**.

### 8.1 States & transitions

```
pending ──enroll──▶ active
active ──step is manual_email & not yet sent──▶ waiting_manual
waiting_manual ──user sends manual email──▶ active (anchor captured, schedule next)
active ──nextRunAt reached──▶ (execute step) ──▶ active (advance) | finished
active ──inbound reply on thread (stopOnReply)──▶ replied (terminal)
active ──hard bounce──▶ bounced (terminal, suppress)
active ──unsubscribe──▶ unsubscribed (terminal, suppress)
active ──send fails after retries──▶ failed (terminal, alert)
any ──user action──▶ paused ⇄ active ; ──user action──▶ finished
```

### 8.2 The flagship "manual-first → auto follow-up" mechanic

There are two entry paths; both converge on the same state machine:

**Path 1 — Sequence starts with a `manual_email` step.**

1. On enroll, engine sees step 0 = `manual_email` → enrollment goes to `waiting_manual` and a **compose task** is created (AI-assist available).
2. User sends from the chosen mailbox. The send executor captures `anchorMessageId` (RFC `Message-ID`) and `anchorThreadId` and writes the outbound `message`.
3. Enrollment → `active`; `nextRunAt` = manual `sentAt` + step 1 delay.

**Path 2 — Enroll an already-sent email into a follow-up-only sequence.**

1. User picks a sent email in the timeline/inbox → "Start follow-up sequence."
2. Quiksend copies that message's `providerMessageId`/`threadId`/`mailboxId` into the new enrollment as the anchor, sets `currentStepOrder = 0` of a follow-up sequence (all `auto_email`), and computes `nextRunAt` from the anchor's `sentAt`.

**Threading the follow-ups.** Every follow-up email for an enrollment with an anchor is sent:

- from the **same mailbox** as the anchor,
- subject = `Re: <anchor subject>` (no duplicate `Re: Re:`),
- headers `In-Reply-To: <anchorMessageId>` and `References: <…anchorMessageId>`,
- via the provider's thread (Gmail `threadId`, Graph `conversationId`, or SMTP with proper headers).

This makes follow-ups land as genuine replies in the prospect's existing thread — exactly the behavior reps want and what protects deliverability.

### 8.3 Scheduler tick (worker)

```ts
// apps/worker/src/scheduler.ts (illustrative)
export async function tick() {
  await db.transaction(async (tx) => {
    const due = await tx.execute(sql`
      SELECT * FROM enrollment
      WHERE state = 'active' AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED        -- safe across multiple workers
    `);
    for (const e of due.rows) {
      await boss.send("execute-step", { enrollmentId: e.id }); // hand off to executor
      // mark in-flight so it isn't re-claimed
      await tx
        .update(enrollment)
        .set({ nextRunAt: null })
        .where(eq(enrollment.id, e.id));
    }
  });
}
// run every 30–60s via pg-boss schedule
```

### 8.4 Step executor

```ts
// apps/worker/src/executeStep.ts (illustrative)
export async function executeStep({ enrollmentId }) {
  const e = await loadEnrollmentWithContext(enrollmentId);

  // 0. Re-check terminal guards (defense in depth)
  if (await isSuppressed(e.org, e.prospect.email)) return finish(e, "unsubscribed");
  if (await hasReplyOnThread(e)) return finish(e, "replied");

  const step = e.steps[e.currentStepOrder];

  switch (step.type) {
    case "wait":
      return advance(e, step);                       // just schedule next
    case "task":
      await createTask(e, step);                      // human queue; advance on completion
      return;
    case "manual_email":
      await setState(e, "waiting_manual");            // wait for user send
      await createComposeTask(e, step);
      return;
    case "auto_email": {
      // Respect mailbox window + daily cap + throttle BEFORE sending
      const slot = await reserveSendSlot(e.mailbox);  // may defer nextRunAt if outside window/cap
      if (slot.deferred) return scheduleAt(e, slot.nextAt);

      const rendered = step.aiGenerate
        ? await generateEmail(e, step)                // AI pipeline (§11)
        : renderTemplate(step, e.prospect, e.org);

      const sent = await sendEmail(e.mailbox, {
        to: e.prospect.email,
        ...threadingHeaders(e),                       // Re:/In-Reply-To/References if anchor
        subject: rendered.subject,
        html: withUnsubscribeFooter(rendered.html, e),
      });
      await recordOutbound(e, step, sent);            // idempotencyKey = (enroll, step, attempt)
      await logCrmActivity(e, sent);                  // §12 write-back (async ok)
      await emitEvent(e.org, "message.sent", { ... });
      return advance(e, step);
    }
  }
}
```

`advance()` computes the next step's `nextRunAt` (respecting `delayMinutes`, `businessDaysOnly`, the mailbox sending window, and conditions like `ifNoReply`). If no next step → `finished`.

### 8.5 Concurrency, idempotency, retries

- **Claiming:** `FOR UPDATE SKIP LOCKED` + nulling `nextRunAt` on hand-off means N workers never double-send.
- **Idempotency:** each send writes a `message` with a unique `idempotencyKey = (enrollmentId, stepId, attempt)`; the send adapter is wrapped so a retried job that already produced a `sent` row is a no-op.
- **Retries:** pg-boss retry with backoff; after max attempts → `failed` + Sentry alert + dead-letter.
- **Stop-on-reply race:** the reply poller writes inbound messages and flips the enrollment to `replied`; the executor re-checks `hasReplyOnThread` immediately before sending.

---

## 9. Email Sending & Mailbox Layer

`packages/email` exposes a single `MailboxAdapter` interface; three implementations.

```ts
export interface MailboxAdapter {
  send(
    input: SendInput,
  ): Promise<{ providerMessageId: string; threadId: string }>;
  listInbound(since: Date): Promise<InboundMessage[]>; // for reply/bounce polling
  verifyDns(domain: string): Promise<DnsHealth>; // SPF/DKIM/DMARC
}
```

- **Gmail** (`provider=gmail`): OAuth via Nango (Google integration) → call Gmail API (`users.messages.send` with raw MIME; reading via `users.messages.list`/`history`). Threading uses Gmail `threadId` + RFC headers.
- **Microsoft 365** (`provider=microsoft`): OAuth via Nango (Microsoft integration) → Microsoft Graph (`/sendMail`, `/messages`). Threading via `conversationId` + headers.
- **SMTP/IMAP** (`provider=smtp`): nodemailer for send, IMAP poll for inbound. Encrypt credentials at rest.

**Using Nango tokens for mailbox calls.** Where the mailbox is OAuth (Gmail/Microsoft), fetch credentials/proxy through Nango using the stored `nangoConnectionId`, so token refresh is handled for you. Example proxy read (also the pattern for Gmail/Graph):

```ts
import { Nango } from "@nangohq/node";
const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

// e.g., read recent Gmail messages for reply detection
const res = await nango.get({
  endpoint: "/gmail/v1/users/me/messages",
  providerConfigKey: "google-mail",
  connectionId: mailbox.nangoConnectionId,
  params: { q: "newer_than:2d" },
});
```

**Sending policy engine (`reserveSendSlot`):** before any auto-send, check (a) inside the mailbox's sending window for its timezone, (b) under daily cap, (c) `minGapSeconds` since last send on that mailbox. If any fails, defer `nextRunAt` to the next legal slot rather than sending. **Mailbox rotation:** when a sequence lists multiple mailboxes, enrollments are distributed round-robin at enroll time (and a single thread always continues from its anchor mailbox).

**react-email** renders templates; a MIME builder assembles multipart (text + html), injects the unsubscribe footer + physical-address footer, applies optional tracking, and sets threading headers.

---

## 10. Reply, Bounce & Unified Inbox ("Primebox")

**Detection (V0 = polling; push as fast-follow).** The worker polls each connected mailbox every 1–2 min for new inbound messages and bounces:

- Match inbound to a thread via `In-Reply-To`/`References` → `providerMessageId` of an outbound message → enrollment/prospect.
- Capture replies even from a _different address_ by also matching on thread id + display heuristics (a Primebox-style nicety).
- **Bounces:** parse DSN / provider bounce signals → mark message `bounced`, prospect `bounced`, add to suppression, terminate enrollment.

**Stop conditions:** on inbound reply to an active enrollment's thread → set enrollment `replied` (if `stopOnReply`), surface in inbox, emit `reply.received`.

**Unified inbox UI:** all threads across all workspace mailboxes in one view, with filters (unread, interested, needs-reply, by sequence), a basic AI **sentiment/triage** tag, reply composer (same mailbox/thread), and optional AI-suggested reply. This directly mirrors the value of Salesforge's Primebox while staying in email-only scope for V0.

**Push upgrade (fast-follow):** Gmail `users.watch` + Pub/Sub and Microsoft Graph change subscriptions hitting `/api/mail/webhook` to replace polling.

---

## 11. AI Research & Generation Pipeline

Model-agnostic via the Vercel AI SDK; every external provider sits behind an interface so you can swap models/search vendors freely.

### 11.1 Research (build a `research_profile`)

```
Inputs:  prospect (email, name, title), company (name, domain), CRM fields (via Nango)
Steps:
  1. CRM context   → pull contact/account fields & recent activity (Nango proxy/sync)
  2. Web research  → search(provider) for "{company} news/announcements", fetch+summarize company site/about
  3. Normalize     → extract structured FACTS: [{claim, source_url, confidence}]
  4. Cache         → store research_profile with freshAt; reuse if fresh (< N days)
Output:  ResearchProfile { facts[], sources[], freshAt }
```

Each fact carries a source so generation can be grounded and auditable (no hallucinated "I saw your Series B" without a source). Freshness TTL avoids re-researching on every send.

### 11.2 Value-prop mapping

The workspace `value_prop` library (products, positioning, proof points, ICP) is combined with the research profile so the model writes _why this sender is relevant to this specific prospect_ — not a generic pitch. This is the substance behind "how our products are applicable to them."

### 11.3 Generation (structured output)

```ts
// packages/ai/generateEmail.ts (illustrative)
import { generateObject } from "ai";
import { z } from "zod";

const EmailSchema = z.object({
  subject: z.string(),
  bodyMarkdown: z.string(),
  angle: z.string(), // "why this approach" rationale
  citedFacts: z.array(z.string()), // which research facts were used
});

export async function generateEmail(ctx: GenContext) {
  const { object } = await generateObject({
    model: ctx.model, // pluggable provider
    schema: EmailSchema,
    system: SYSTEM_PROMPT, // tone, length, anti-spam, no fabrication beyond facts
    prompt: buildPrompt({
      prospect: ctx.prospect,
      research: ctx.researchProfile, // grounded facts + sources
      valueProp: ctx.valueProp,
      step: ctx.step, // first-touch vs follow-up framing
      threadContext: ctx.priorMessages,
    }),
  });
  return humanize(object); // §11.4
}
```

Guardrails baked into the system prompt + post-processing: ground claims in `facts` only, target length/tone, avoid spam-trigger phrasing, and never invent specifics.

### 11.4 Humanization & spintax (reuse your existing skill)

Pipe the draft through the existing **`cold-email-humanizer`** skill's framework: spintax for at-scale variation, humanization to reduce template-fingerprint, and a spam-phrase lint surfaced to the user. This is the same deliverability discipline Salesforge gets from spintax + uniqueness, but reusable and inspectable.

### 11.5 Human-in-the-loop

- **First touch** defaults to **draft → review → send** (especially in the manual-first flow).
- Follow-ups with `aiGenerate=true` can be auto-sent _or_ held for review per sequence setting.
- Every generation is stored (`ai_generation` via `event`/profile linkage) for audit and A/B learning.

> Autonomous end-to-end generation+send (an "Agent Frank"-style SDR) is intentionally a **fast-follow**, layered on top of this exact pipeline by removing the review gate behind an explicit opt-in.

---

## 12. CRM Integrations (Nango: Salesforce + HubSpot)

Nango handles OAuth, token refresh, proxying, and scheduled syncs/actions for both CRMs (and, as noted, Google/Microsoft mailbox OAuth).

### 12.1 Connect flow (frontend ⇄ backend)

**Backend — mint a Connect session** (scoped to the Better Auth org → clean multi-tenancy):

```ts
// server fn: create a Nango connect session for the active workspace
import { Nango } from "@nangohq/node";
const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

export const createCrmConnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ integration: z.enum(["salesforce", "hubspot"]) }))
  .handler(async ({ data, context }) => {
    const { data: session } = await nango.createConnectSession({
      tags: {
        end_user_id: context.user.id,
        end_user_email: context.user.email,
        organization_id: context.orgId, // ← ties the connection to the workspace
      },
      allowed_integrations: [data.integration],
    });
    return { sessionToken: session.token };
  });
```

**Frontend — open the Connect UI** and persist the connection on success:

```ts
import Nango from "@nangohq/frontend";
const nango = new Nango();
const connect = nango.openConnectUI({
  onEvent: (event) => {
    if (event.type === "connect") saveCrmConnection(event); // → crm_connection row
  },
});
const { sessionToken } = await createCrmConnectSession({
  data: { integration: "salesforce" },
});
connect.setSessionToken(sessionToken);
```

### 12.2 Inbound: contact/account sync (checkpointed)

Use Nango syncs to pull Contacts/Leads/Accounts incrementally; map into `prospect`/`company`. Pattern (Salesforce contacts shown; HubSpot analogous against `/crm/v3/objects/contacts`):

```ts
import { createSync } from "nango";
import * as z from "zod";

export default createSync({
  description: "Sync Salesforce contacts",
  frequency: "every hour",
  checkpoint: z.object({ lastModifiedISO: z.string() }),
  models: { Contact: ContactSchema },
  exec: async (nango) => {
    const cp = await nango.getCheckpoint();
    let q =
      "SELECT Id, FirstName, LastName, Email, Title, LastModifiedDate FROM Contact";
    if (cp) q += ` WHERE LastModifiedDate > ${cp.lastModifiedISO}`;
    q += " ORDER BY LastModifiedDate ASC";
    for await (const page of nango.paginate({
      endpoint: "/services/data/v53.0/query",
      params: { q },
      paginate: {
        type: "link",
        response_path: "records",
        link_path_in_response_body: "nextRecordsUrl",
      },
    })) {
      const contacts = mapContacts(page);
      await nango.batchSave(contacts, "Contact");
      await nango.saveCheckpoint({
        lastModifiedISO: contacts.at(-1)!.last_modified_date,
      });
    }
  },
});
```

### 12.3 Outbound: write-back (actions / proxy)

- **Activity logging:** on `message.sent` and `reply.received`, write a Salesforce **Task** / HubSpot **Engagement** on the matching contact (via Nango action or proxy `POST`).
- **Contact upsert:** when a prospect is created locally, create/update the CRM contact per `field_mapping`.
- **Status sync:** on `replied`/`unsubscribed`/meeting-booked, update a configurable CRM property/status.

### 12.4 Webhooks

- Nango → `/api/nango/webhook` notifies on new/updated records and sync completions → keep prospects fresh and trigger re-research if a prospect's role/company changed.
- Field mapping is per-workspace JSON (`crm_connection.field_mapping`), editable in settings.

---

## 13. API & Server-Function Design (TanStack Start)

**Two surfaces, one codebase:**

1. **In-app RPC** — `createServerFn` for everything the UI does (typed, validated with Zod, guarded by `authMiddleware`). Loaders + TanStack Query consume them with SSR + caching.

2. **Server routes (`createFileRoute … server.handlers`)** for non-RPC HTTP:
   - `/api/auth/$` → Better Auth.
   - `/api/v1/*` → **public REST API**, authenticated via Better Auth **apiKey** plugin (verify key → resolve org → scope).
   - `/api/nango/webhook`, `/api/mail/webhook` → inbound webhooks (verify signatures).
   - `/api/track/open/:id`, `/api/track/click/:id` → optional tracking endpoints.

Public API example:

```ts
// apps/web/src/routes/api/v1/prospects.ts
export const Route = createFileRoute("/api/v1/prospects")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const org = await resolveApiKey(request); // Better Auth apiKey verify
        if (!org) return json({ error: "unauthorized" }, { status: 401 });
        const body = ProspectCreate.parse(await request.json());
        const created = await createProspect(org.id, body);
        return json(created, { status: 201 });
      },
    },
  },
});
```

**Outbound webhooks:** HMAC-signed POSTs on `message.sent`, `reply.received`, `enrollment.finished`, `prospect.unsubscribed`, with retry + delivery log.

---

## 14. Deliverability, Compliance & Non-Functional Requirements

**Deliverability**

- Thread follow-ups under the original message (the manual-first flow does this natively).
- Per-mailbox **sending windows, daily caps, inter-send throttle**; **rotation** across mailboxes.
- **Spintax + humanization** for content variation; spam-phrase lint.
- **SPF/DKIM/DMARC checker** per sending domain with remediation hints (provisioning/warm-up are fast-follow).
- Open/click **tracking off by default** (custom tracking domains hurt placement); when enabled, document the tradeoff.

**Compliance (CAN-SPAM / GDPR-aware)**

- Mandatory **unsubscribe** mechanism + physical address footer (configurable, on by default).
- **Suppression list** consulted before _every_ send; unsubscribes/bounces/complaints auto-suppress and (optionally) write back to CRM.
- Per-workspace data retention controls; right-to-delete a prospect cascades.

**Security**

- All app queries scoped by `organizationId` (CI guard + optional Postgres RLS).
- Secrets server-only; mailbox SMTP creds encrypted at rest; prefer Nango's vault for OAuth tokens.
- Rate limiting on auth + public API; Zod validation at every boundary; Better Auth CSRF/session protections.
- Webhook signature verification (Nango + provider + our outbound HMAC).

**Observability & Quality**

- **Sentry** (errors, worker job failures), **PostHog** (product analytics, funnel), **pino** structured logs, queue depth/lag metrics.
- **Testing:** unit (engine state transitions, slot reservation, threading headers, suppression), integration (Nango sandbox, mail send against a test SMTP like Mailpit), e2e (enroll → schedule → send → reply → stop).
- **Clean-build gate** (adapt your usual pipeline; no Cloudflare codegen here):
  `pnpm install → pnpm -r typecheck (tsc --noEmit) → pnpm lint → pnpm -r test (vitest run) → pnpm -r build → drizzle migrations check`.
- Delivery preferences honored: complete files (not diffs), single clean zip for full-project handoffs, pnpm throughout.

**Deployment topology**

- `apps/web` (TanStack Start, Node server output) behind your reverse proxy; `apps/worker` as a separate always-on process; Postgres managed or self-hosted; Nango Cloud (or self-hosted Nango) for integrations. Worker can run on the home Ubuntu/Docker box; web can sit on a VPS. `docker-compose` for the full local + self-host stack.

**Postgres operational notes**

- **Driver/pooling:** `drizzle-orm/postgres-js` (or `node-postgres`) with a normal pool — both web and worker are long-lived Node processes, so pooling is straightforward. One gotcha: if you front PG with a **transaction-mode** pooler (PgBouncer, Neon's pooled endpoint), prepared statements break — set `postgres.js` `prepare: false` or use the session/direct endpoint. The worker should connect to a direct (non-transaction-pooled) endpoint.
- **Local = prod parity:** run Postgres in Docker locally (already in R-003) rather than SQLite, so `SKIP LOCKED` and JSON semantics match production and bugs don't hide until deploy.
- **pgvector:** enable the extension when the AI research/inbox phase (Phase 8) lands — used for semantic dedup, reply matching, and research caching. No need to enable it before then.

---

## 15. Implementation Plan (phased & ticketed)

Sequenced so each phase is demoable. Ticket IDs are stable references for Linear.

### Phase 0 — Foundation (infra & tooling)

- **R-001** pnpm workspace + Turbo tasks (typecheck/test/build) + `tsconfig.base.json` + **Oxlint + Oxfmt** (pinned exact; `oxlint.config.ts` with browser/React vs Node overrides, `oxfmt.config.ts`). Oxlint owns correctness/logic, Oxfmt owns all formatting. Root scripts: `lint`/`format`/`typecheck`/`test`/`check`. Editor config (`.vscode`) for the Oxc extension. **(Built — see Phase 0 zip.)**
- **R-002** `packages/config`: zod-validated env loader (fail-fast; pure schema split into `env.schema.ts` for testability) + pino logger. **(Built.)**
- **R-003** `packages/db`: Drizzle + `postgres-js` client, `drizzle.config.ts`, programmatic migrator, baseline migration; `docker-compose` (pgvector Postgres + Mailpit); root `.env` loaded via `dotenv-cli` in db scripts. **(Built.)**
- **R-004** CI (GitHub Actions) running `pnpm install --frozen-lockfile` → the `check` gate, with a Postgres service; Sentry + PostHog SDK wiring stubs. **(Built.)**
- _Exit:_ `pnpm check` (lint + format + typecheck + test) green on the skeleton; `docker compose up` + `pnpm db:generate && pnpm db:migrate` applies the baseline. **(Verified: lint 0/0, format clean, 4/4 typecheck, tests pass.)**

### Phase 1 — Auth & Workspaces

- **R-010** Better Auth config (Drizzle adapter, email/password + Google/Microsoft).
- **R-011** `organization` plugin → workspaces, members, roles, invitations.
- **R-012** `apiKey` plugin scaffolding.
- **R-013** TanStack Start auth mount (`/api/auth/$`), `authMiddleware`, route guards, workspace switcher, app shell.
- **R-014** UI foundation: `packages/ui` with shadcn/ui init (`components.json`, `cn()`), OKLCH light/dark theme tokens, Tailwind config; base layout/nav; react-hook-form + Zod resolver wiring. (TanStack Table + dnd-kit added in their respective phases.)
- _Exit (AC A1–A3):_ sign up, create/switch workspaces, invite a member; all subsequent data scoped to active workspace.

### Phase 2 — Prospects & Companies

- **R-020** Schema + CRUD server fns for `company`/`prospect` (org-scoped).
- **R-021** CSV import with column mapping + dedupe + validation.
- **R-022** Prospect detail view (timeline, fields, sequence history shells).
- _Exit (AC C1, C3):_ import a CSV, view prospects.

### Phase 3 — Nango wiring + inbound CRM sync

- **R-030** `packages/integrations`: Nango node client wrapper; `crm_connection` model.
- **R-031** Connect flow: `createCrmConnectSession` server fn + `openConnectUI` UI (Salesforce + HubSpot).
- **R-032** Checkpointed contact/account syncs (SF + HS) → map into prospects/companies.
- **R-033** Field-mapping settings UI; Nango webhook route `/api/nango/webhook`.
- _Exit (AC C2):_ connect SF or HS, pull contacts into a list, see fresh updates via webhook.

### Phase 4 — Mailboxes & single send

- **R-040** `MailboxAdapter` interface + Gmail (via Nango), Microsoft Graph (via Nango), SMTP (nodemailer) implementations.
- **R-041** Mailbox connect UI + settings (cap, window, throttle, signature, from-name).
- **R-042** react-email + MIME builder + threading headers + unsubscribe/address footer.
- **R-043** Compose & send a one-off email; capture anchor (Message-ID/threadId); write outbound `message`.
- **R-044** SPF/DKIM/DMARC checker + health flags.
- _Exit (AC B1–B3, E1):_ connect a mailbox, send a manual email, see it threaded and recorded with anchor.

### Phase 5 — Sequence model & builder

- **R-050** `sequence`/`sequence_step` schema + CRUD server fns.
- **R-051** Sequence builder UI: ordered steps (`manual_email`/`auto_email`/`wait`/`task`), delays, conditions, A/B variant B, AI-generate flag.
- **R-052** Sequence settings (window/tz/throttle/mailboxes/stopOnReply).
- **R-053** Enrollment creation (single + bulk) with mailbox round-robin + schedule preview.
- _Exit (AC D1–D5):_ build a sequence and enroll prospects; see computed schedule.

### Phase 6 — Scheduler & engine (the core)

- **R-060** `packages/core`: enrollment state machine + transition functions (pure, unit-tested).
- **R-061** pg-boss setup; scheduler tick with `FOR UPDATE SKIP LOCKED`.
- **R-062** Step executor: wait/task/manual_email/auto_email; `reserveSendSlot` (window/cap/throttle); `advance`.
- **R-063** Idempotency keys + retries + dead-letter + Sentry alerts.
- **R-064** Manual-first mechanics: `waiting_manual` → compose task → on-send anchor capture → schedule follow-ups threaded under anchor; "start follow-up from existing email."
- _Exit (AC E1–E4, D core):_ a manual first email followed by automated, correctly-threaded, throttled follow-ups; pause/resume/stop works; multi-worker safe.

### Phase 7 — Replies, bounces, unified inbox

- **R-070** Inbound poller (Gmail/Graph/IMAP) + thread matching + bounce/DSN parsing.
- **R-071** Stop-on-reply / suppress-on-bounce transitions wired to the engine.
- **R-072** Unified inbox UI (filters, thread view, reply composer) + sentiment/triage tag.
- _Exit (AC G1–G4, I3):_ replies appear in inbox, stop sequences; bounces suppress + terminate.

### Phase 8 — AI research & generation

- **R-080** `packages/ai`: provider-agnostic model + search interfaces.
- **R-081** Research pipeline → `research_profile` (CRM + web), with sources + freshness TTL.
- **R-082** Value-prop library CRUD; prompt builder; `generateObject` structured generation.
- **R-083** Integrate `cold-email-humanizer` skill (spintax/humanize/spam-lint); A/B variant gen.
- **R-084** Review UI (draft → edit → approve) in compose + sequence steps.
- _Exit (AC F1–F4, E1 AI-assist):_ generate a grounded, value-prop-mapped email a human can review and send.

### Phase 9 — CRM write-back & analytics

- **R-090** Activity logging on send/reply (SF Task / HS Engagement) via Nango action/proxy.
- **R-091** Contact upsert + status write-back on key events.
- **R-092** Analytics: per-sequence funnel, per-step rates, A/B compare, per-mailbox volume/bounce.
- _Exit (AC H1–H3, J1–J3):_ CRM reflects Quiksend activity; dashboards populate.

### Phase 10 — Public API, webhooks, hardening

- **R-100** Public REST API (`/api/v1/*`) with apiKey auth (prospects, enroll, analytics read).
- **R-101** Outbound webhooks (HMAC, retries, delivery log).
- **R-102** Suppression/unsubscribe end-to-end (link → handler → suppress → CRM); compliance footers.
- **R-103** Security pass (rate limits, tenancy CI guard, secret review), load test the scheduler, docs + self-host `docker-compose` + seed.
- _Exit (AC I1–I2, K1–K2):_ third party can drive Quiksend via API; unsubscribe/compliance verified; self-host story documented.

> **Suggested cutline for a usable internal alpha:** Phases 0–7 (you can run real manual-first + automated follow-ups with CRM-sourced prospects and a working inbox). Phases 8–10 complete the V0 differentiation (AI, write-back, API, compliance).

---

## 16. Definition of Done for V0

V0 ships when all three brief must-haves plus the core "genuinely useful" set are demonstrably working:

1. ✅ **Manual-first → auto follow-up:** send a manual first email; enroll the prospect + that thread into a follow-up sequence; follow-ups send on schedule, threaded under the original, throttled per mailbox, and **stop on reply**.
2. ✅ **Research-grounded AI generation:** generate a first email (and follow-ups) using live researched facts about the prospect + company and a mapping of the workspace's value prop, with human review.
3. ✅ **Salesforce + HubSpot via Nango:** connect both, sync contacts in, log activities + update status out.
4. ✅ **Supporting set:** multi-tenant workspaces; mailbox connect (Gmail/365/SMTP) with windows/caps/throttle/rotation; unified inbox with reply + bounce handling; suppression + unsubscribe; basic A/B; analytics funnel; public API + webhooks; SPF/DKIM/DMARC checker.
5. ✅ **Quality gates:** clean-build pipeline green; engine unit/integration/e2e tests passing; Sentry + PostHog wired; self-host `docker-compose` documented.

---

## 17. Risks & Open Questions

| #   | Risk / Question                                                       | Mitigation / Decision needed                                                                                                                                                    |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Scheduler at scale** (many enrollments, tight windows).             | `SKIP LOCKED` + per-mailbox slot reservation handles correctness; if volume grows, shard workers by mailbox/org or move to Inngest/Trigger.dev durable workflows.               |
| 2   | **Mailbox API quotas / throttling** (Gmail/Graph send limits).        | Respect provider quotas in `reserveSendSlot`; surface health; rotation spreads load.                                                                                            |
| 3   | **Reply detection via polling** may lag / miss cross-address replies. | V0 polling acceptable; upgrade to Gmail watch + Graph subscriptions (fast-follow); thread+heuristic matching for different-address replies.                                     |
| 4   | **AI hallucination** in personalization.                              | Ground strictly in sourced `facts`; human review on first touch; store generations for audit.                                                                                   |
| 5   | **Nango self-host vs cloud.**                                         | Decide early: Nango Cloud is fastest; self-hosting Nango keeps everything in-house (aligns with "own your stack") but adds ops.                                                 |
| 6   | **Deliverability without warm-up** in V0.                             | Document clearly: BYO warmed mailboxes for now; warm-up pool is a defined fast-follow with an interface stub.                                                                   |
| 7   | **Job queue choice** (pg-boss vs durable-workflow engine).            | Start pg-boss (no new infra). Revisit if you want visual workflow/observability — the engine is isolated in `packages/core`, so swapping the executor's transport is contained. |
| 8   | **CRM field-mapping variability** across orgs.                        | Per-workspace JSON mapping + sane defaults; validate against CRM schema on connect.                                                                                             |
| 9   | **Tracking pixels vs deliverability.**                                | Default off; expose as an explicit, caveated toggle.                                                                                                                            |
| 10  | **Scope creep toward LinkedIn / AI SDR.**                             | Both explicitly fast-follow; the step model + generation pipeline are designed to absorb them without rework.                                                                   |

---

### Appendix: API references grounded for this build

- **TanStack Start:** `createServerFn({ method }).validator(zod).middleware([...]).handler(...)`; server routes via `createFileRoute('/path')({ server: { handlers: { GET, POST } } })`; sessions in server fns with `getRequestHeaders()`.
- **Better Auth:** `betterAuth({ database: drizzleAdapter(db,{provider:'pg',schema}), plugins:[organization(), apiKey()] })`; `auth.handler(request)`; `auth.api.getSession({ headers })`.
- **Nango:** backend `new Nango({ secretKey }).createConnectSession({ tags, allowed_integrations })`; frontend `nango.openConnectUI({ onEvent })` + `connect.setSessionToken(token)`; backend reads via `nango.get/proxy`; `createSync({ checkpoint, models, exec })` with `nango.paginate` + `nango.batchSave` + `nango.saveCheckpoint`.
