# WAVE_CONTEXT.md - Wave 6 (Cleanup + Docs)

**Read `CLAUDE.md` first.** Then read your track brief.

## What this is

Wave 5 (v2.1.0) closed the 3 CRITICAL + 11 flagged HIGH findings from the V0 review.
Wave 6 is the small cleanup train:

- **Track OMEGA** — the last real findings from the review (~10 items, all LOW/MED, plus
  2 HIGH-severity ARCH items that were structurally covered by ALPHA but not
  fully-fanned into the web app).
- **Track PSI** — real-user documentation. `docs/self-host.md` is a stub, `README.md`
  positions Quiksend as "Outreach alternative" but never says how to install it.
  Fix that.

Both tracks run in parallel worktrees. No shared file overlap by construction.

## Non-negotiables (same as Wave 5)

- `pnpm install --frozen-lockfile` FIRST on the fresh worktree.
- **Context7 MCP for any library lookup.** Do not rely on training data for API shapes.
- `pnpm check` MUST be **green** on OMEGA (zero lint, zero type, zero failing tests).
  PSI touches only markdown → no test impact.
- Migration numbering: nothing in Wave 6 should need a migration. If you find yourself
  needing one, write NEEDS.md and stop — that's Wave 7 scope.
- Explicit `.ts`/`.tsx` extensions on relative imports; `import type` for type-only imports.
- Write `RESULT.json` at the worktree root when done.

## Boundaries

- **OMEGA** owns: `apps/web/src/lib/{compose,sequences,inbox}.functions.ts`,
  `apps/web/src/lib/api/v1/effect-executor.ts` (NEW), `apps/web/src/lib/analytics.functions.ts`,
  test files it modifies. See brief.
- **PSI** owns: `README.md`, `docs/**/*.md`, potentially `docker-compose.prod.yml` if
  documented setup requires a tweak. No `.ts` files.

## Result payload

Write `RESULT.json` at worktree root:

```json
{
  "status": "ok" | "partial" | "blocked",
  "track": "OMEGA" | "PSI",
  "findings_addressed": ["ARCH-002", ...],
  "findings_deferred": [],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
