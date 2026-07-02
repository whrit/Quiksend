# PHASE-8: AI research + generation + humanizer + review UI — Track K

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-8-ai` from `main` (worktree isolated).

## Context

Read at repo root first:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` files (root + wave4)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` section "Phase 8"
4. `packages/ai/` — Phase 8-prep landed provider-agnostic interfaces + value_prop CRUD
5. `packages/db/src/schema/ai.ts` — Phase 8-prep landed value_prop + research_profile
6. `packages/integrations/src/nango.ts` — CRM context via Nango proxy

Phase 8-prep laid the plumbing (interfaces, tables). Phase 8 proper wires them:
research pipeline (CRM + web + summarize → research_profile), prompt builder
(pulls research + value props), generation via `generateObject`, humanizer
integration, and the human-review UI.

## Documentation lookup (mandatory)

Context7 MCP for:

- **`ai`** SDK (Vercel AI SDK) — `generateObject`, `generateText`, `tool` for
  provider-agnostic model calls
- **`@ai-sdk/anthropic`** + **`@ai-sdk/openai`** — provider adapters
- **Zod v4** — schema for `EmailSchema` in generation
- **Web search** — Exa/Tavily/Brave APIs (pick one; verify current API via Context7)
- **Drizzle** — pgvector column type (`vector(dim)`), HNSW index syntax
- **cold-email-humanizer** skill — read `.claude/skills/cold-email-humanizer/` if
  present; otherwise implement spintax + spam-phrase lint inline

## Tasks

### T1 — Extend schema (`packages/db/src/schema/ai.ts`)

Phase 8-prep added `value_prop` + `research_profile`. Extend:

- **`generation`** — id (uuid pk), organization_id, prospect_id, enrollment_id
  (nullable), step_id (nullable), variant text ('A' | 'B'),
  prompt jsonb (the full prompt payload for audit),
  model text (which model was used),
  output_subject text, output_body_markdown text, output_rationale text,
  cited_facts jsonb (which research facts grounded which claims),
  humanized boolean default false,
  status pg enum ('draft', 'approved', 'sent', 'discarded') default 'draft',
  approved_by_user_id (text FK nullable), approved_at (timestamptz nullable),
  timestamps.
  Index `(organization_id, prospect_id, created_at DESC)`.

Add pgvector embedding to research_profile if not already there:

- `embedding vector(1536)` (OpenAI text-embedding-3-small dim)
- HNSW index for cosine similarity

### T2 — Research pipeline (`packages/ai/src/research/`)

- `fetch-crm-context.ts` — pulls prospect + company + recent activity from CRM
  via `getNango().proxy(...)` (only if CRM connection exists for this workspace;
  otherwise skip)
- `search-web.ts` — search provider interface. Default: single search query
  `"{company_name} news OR announcement OR blog"` returning top 5.
- `fetch-and-summarize.ts` — fetch top URLs, extract main text (readability lib),
  summarize via `generateText` into structured facts:
  `[{ claim, source_url, confidence: 0..1 }]`
- `build-profile.ts` — orchestrator. Runs CRM + web in parallel, dedupes facts,
  writes `research_profile` row with `fresh_until` = now + 14d.

### T3 — Generation (`packages/ai/src/generation/`)

- `prompt-builder.ts` — takes:
  - `research_profile` (facts + sources)
  - top-N `value_prop` rows retrieved via pgvector similarity against research summary
  - `step` (subject/body template if not `ai_generate: true`, or full generation)
  - `thread_context` (prior messages if follow-up)
    builds a system prompt + user prompt.
- `generate-email.ts` — calls `generateObject({ model, schema: EmailSchema, ... })`
  with retries on schema-parse failure (bounded to 2). Returns `Generation`
  object; caller persists to `generation` table.
- Zod schema:
  ```ts
  EmailSchema = z.object({
    subject: z.string().min(1).max(200),
    body_markdown: z.string().min(50).max(3000),
    angle: z.string(), // "why this approach" rationale
    cited_facts: z.array(
      z.object({
        claim: z.string(),
        source_url: z.string().url().optional(),
      }),
    ),
  });
  ```

### T4 — Humanizer (`packages/ai/src/humanize/`)

Port the `cold-email-humanizer` skill's logic OR call it as a subagent.
Inline implementation is fine:

- Spintax parser: `{option1|option2|option3}` → picks one (deterministic
  seeded by generation_id for reproducibility)
- Spam-phrase lint: check against a list of trigger phrases, surface warnings
- Length + reading-grade check

### T5 — Server fns (`apps/web/src/lib/ai.functions.ts`)

- `generateEmailForProspect({ prospectId, stepId?, enrollmentId?, forceResearch? })`
  — kicks off research if profile missing/stale, then generates. Returns the
  generation row.
- `approveGeneration({ generationId, edits? })` — writes edits back to
  `output_subject`/`output_body_markdown`, sets `status='approved'`.
- `discardGeneration({ generationId })`.
- `listValueProps()` + `upsertValueProp()` + `deleteValueProp()` — CRUD.
- `triggerResearch({ prospectId })` — enqueues `ai.research` job (Phase 8-prep
  registered the handler).

### T6 — Worker handler (`apps/worker/src/handlers/ai-research.ts`)

Register `ai.research`:

```ts
registerHandler("ai.research", async ({ prospectId, forceRefresh }) => {
  await buildProfile(prospectId, { forceRefresh });
});
```

### T7 — Review UI

- `apps/web/src/routes/_protected/prospects/$id/generate.tsx` — new tab on
  prospect detail: shows research profile + value-prop matching + latest
  generation. "Generate email" button, "Approve"/"Discard"/"Regenerate" actions.
- Extend sequence step editor (Phase 5 owns the file — this is the ONE cross-
  boundary touch; keep it minimal): when `ai_generate: true`, add a
  "Preview generation for a sample prospect" button that opens a review dialog.
- Compose page (Phase 4-back owns) — add optional "AI-assist" button that pre-
  fills subject + body using generation for the selected prospect.
- Value-prop settings page (`_protected/settings/value-props.tsx`) — CRUD list.

### T8 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase8_ai
pnpm db:migrate
pnpm check   # green
```

Manual smoke:

- Add a value_prop for the workspace.
- Pick a prospect with a company_domain populated.
- Trigger research → verify facts populated with sources.
- Generate email → verify structured output (subject + body + rationale + cited_facts).
- Approve → check `generation.status = 'approved'`.
- Verify humanizer output differs from raw model output (spintax + variation).

## Constraints

- **Touch ONLY**:
  - `packages/db/src/schema/ai.ts` (extend — Phase 8-prep created)
  - `packages/db/src/schema/index.ts` (verify export)
  - `packages/db/src/tenancy-guard.test.ts` + testing.ts
  - `packages/ai/src/research/**`, `packages/ai/src/generation/**`, `packages/ai/src/humanize/**` (new subdirs; don't touch existing interfaces)
  - `apps/worker/src/handlers/ai-research.ts` (new)
  - `apps/web/src/lib/ai.functions.ts` (new)
  - `apps/web/src/routes/_protected/prospects/$id/generate.tsx` (new)
  - `apps/web/src/routes/_protected/settings/value-props.tsx` (new)
  - `apps/web/src/routes/_protected/compose.tsx` (extend; MINIMAL — just add AI-assist button)
  - `apps/web/src/routes/_protected/sequences/$id/edit.tsx` (extend; MINIMAL — preview button)
- **DO NOT** modify `packages/ai/src/{provider,search}.ts` (Phase 8-prep interfaces)
- Context7 MCP for `ai` SDK, `@ai-sdk/*`, web search API, pgvector
- **Prompt injection safety**: sources may be adversarial. System prompt
  explicitly warns; only ground claims in cited_facts

## Result

```json
{
  "status": "ok",
  "files": ["packages/ai/src/generation/generate-email.ts", "..."],
  "notes": "Phase 8 complete. pnpm check green. Research pipeline caches to research_profile with 14d TTL. generateObject with EmailSchema + 2 retries on parse failure. Humanizer applies spintax + spam-lint. Human review UI on prospect detail; approve/discard/regenerate wired."
}
```
