# PHASE-8-PREP: packages/ai interfaces + value_prop CRUD + research_profile schema — Track I

## Repo

`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch

`feat/phase-8-prep-ai` from `main` (worktree isolated).

## Context

Read at repo root first:

1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (root + wave3)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` — Phase 8 section
4. `packages/queue/src/jobs.ts` — `ai.research` job type already registered

Side-quest running in parallel with Phase 6 engine. Provides the interfaces
and schemas Phase 8 proper (Wave 4) wires up.

## Documentation lookup (mandatory)

Context7 MCP for:

- **`ai`** SDK (Vercel AI SDK) — `LanguageModel` interface, provider adapter shape
- **`@ai-sdk/anthropic`** + **`@ai-sdk/openai`** — provider instantiation
- **Drizzle** — `vector(dim)` column type via `pgvector`, HNSW index syntax
- **pgvector** — the pg17 image has it available; check extension name/syntax

## Tasks

### T1 — New package (`packages/ai/`)

Create `packages/ai/` with:

- `package.json` — deps: `@quiksend/config`, `@quiksend/db`, `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `zod`
- `tsconfig.json` — extends `../../tsconfig.base.json`
- `src/index.ts` — barrel

### T2 — Model provider interface (`packages/ai/src/model/`)

```ts
// types.ts
export type ModelProviderId = "anthropic" | "openai";
export interface ModelSpec {
  readonly provider: ModelProviderId;
  readonly modelId: string; // "claude-4.5-sonnet", "gpt-4o", etc.
}

// provider.ts
import type { LanguageModel } from "ai";
export function resolveModel(spec: ModelSpec): LanguageModel;
```

`resolveModel` switches on `spec.provider`:

- `anthropic` → `import { anthropic } from "@ai-sdk/anthropic"; return anthropic(spec.modelId)`
  — requires `ANTHROPIC_API_KEY`
- `openai` → `import { openai } from "@ai-sdk/openai"; return openai(spec.modelId)`
  — requires `OPENAI_API_KEY`

Throws a clear error when the required env var is missing.

Add a `getDefaultModel()` helper reading `env.AI_DEFAULT_PROVIDER` (already
declared) and returning a sane default per provider (Claude 4.5 Sonnet for
Anthropic, gpt-4o for OpenAI).

Unit tests with the missing-env-var scenario (should throw); provider
instantiation is a smoke test — we don't need to actually call an LLM.

### T3 — Search provider interface (`packages/ai/src/search/`)

```ts
// types.ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface SearchProvider {
  readonly id: "exa" | "tavily" | "brave" | "fake";
  search(
    query: string,
    options?: {
      limit?: number;
      recency?: "day" | "week" | "month" | "year" | null;
    },
  ): Promise<SearchResult[]>;
}

// provider.ts
export function createSearchProvider(id: SearchProvider["id"]): SearchProvider;
```

Implementations:

- **`fake.ts`** — returns pre-canned results from a fixture map keyed by query.
  Used in tests. THIS IS THE ONLY IMPLEMENTATION Track I ships.
  Phase 8 proper adds real providers.

Unit test the fake provider returns the expected fixtures.

### T4 — Fetch-and-extract stub (`packages/ai/src/fetch/`)

```ts
export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  mainText: string;
  extractedAt: string;
}

export async function fetchAndExtract(url: string): Promise<FetchedPage>;
```

Uses `fetch()` with a 10s timeout + a user-agent that identifies as Quiksend
research bot. Extract main text via a lightweight readability library (pick via
Context7 — `@mozilla/readability` needs a DOM; use `article-parser` or
`jsdom + readability` or a simpler regex-based content-heuristic if none work
cleanly).

For Phase 8-prep, a simple heuristic implementation is fine:

- Strip `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`
- Return the text content of `<main>` OR `<article>` OR `<body>` in that order

Unit test with a fixture HTML file.

### T5 — Schema (`packages/db/src/schema/ai.ts`)

Enable pgvector on the DB (via a migration that runs `CREATE EXTENSION IF NOT
EXISTS vector`).

- **`value_prop`** — id (uuid pk), organization_id (text FK cascade),
  title text notNull, body text notNull, tags text[] default '{}',
  embedding vector(1536) nullable (populated later),
  created_by_user_id text FK, timestamps.
  Index: HNSW on `embedding` with `vector_cosine_ops`.

- **`research_profile`** — id (uuid pk), organization_id (text FK cascade),
  prospect_id (uuid FK cascade),
  facts jsonb notNull default '[]' — array of `{claim, source_url, confidence}`,
  sources jsonb notNull default '[]' — array of `{url, title, published_at}`,
  summary text nullable,
  embedding vector(1536) nullable,
  fresh_until timestamptz nullable,
  status pg enum ('pending', 'ready', 'error') default 'pending',
  error text nullable,
  timestamps.
  Index: `(organization_id, prospect_id)` unique; HNSW on `embedding`.

Barrel + tenancy guard + testing.ts.

### T6 — Value-prop CRUD (`apps/web/src/lib/value-props.functions.ts`)

- `listValueProps()` — org-scoped, ordered by created_at desc.
- `getValueProp({ id })` — 404 outside org.
- `createValueProp({ title, body, tags? })` — org-scoped, `created_by_user_id`
  = current user.
- `updateValueProp({ id, patch })` — narrow Zod patch.
- `deleteValueProp({ id })` — hard delete (rare, low-volume).

Note: no embedding generation yet — Phase 8 proper adds a lifecycle hook that
regenerates embeddings on create/update. For now, leave `embedding` NULL.

### T7 — Settings UI (`apps/web/src/routes/_protected/settings/value-props/`)

- `index.tsx` — table of value props with columns: title, tags (badges),
  updated_at, actions (edit, delete).
- Dialog for create/edit with title + body (Textarea) + tags (comma-separated).
- Toast on mutations.

### T8 — Migration

`pnpm db:generate --name phase8prep_ai_interfaces` → review → `pnpm db:migrate`.
Confirm the pgvector extension creates cleanly on the existing pg17 image.

### T9 — Verification (STRICT)

```bash
pnpm install --frozen-lockfile
pnpm db:generate --name phase8prep_ai_interfaces
pnpm db:migrate
pnpm check   # green
```

Manual smoke:

- Load `/settings/value-props` — empty state.
- Create a value prop (title + body + tags).
- Verify DB row exists with `embedding IS NULL`.
- Edit → save → row updates.
- Delete → gone.
- `getDefaultModel()` throws with a clear error when ANTHROPIC_API_KEY is unset
  and `AI_DEFAULT_PROVIDER=anthropic` (test in isolation, don't actually leave
  the app in a broken state).

## Constraints

- **Touch ONLY**:
  - `packages/ai/` (new package)
  - `packages/db/src/schema/ai.ts` (new)
  - `packages/db/src/schema/index.ts` (add export)
  - `packages/db/src/tenancy-guard.test.ts` + testing.ts
  - `apps/web/src/lib/value-props.functions.ts` (new)
  - `apps/web/src/routes/_protected/settings/value-props/**` (new)
- **DO NOT** implement the research pipeline or generation — Phase 8 proper
  owns those. Track I is INTERFACES + SCHEMAS ONLY.
- Context7 MCP for `ai` SDK, `@ai-sdk/*`, pgvector Drizzle syntax

## Result

```json
{
  "status": "ok",
  "files": ["packages/ai/src/model/provider.ts", "..."],
  "notes": "Phase 8-prep complete. pnpm check green. Model/search/fetch interfaces in packages/ai (fake search provider only; real ones land in Phase 8). value_prop + research_profile tables with pgvector embedding columns; HNSW indexes created. Value-prop CRUD UI functional; embeddings will populate in Phase 8 proper."
}
```
