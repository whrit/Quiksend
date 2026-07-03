# Phase 11 Full Review — Shared Context

## Scope

**Baseline commit**: `d89d5e4` (v2.1.1 — Wave 6 landing, review report closed)
**HEAD commit**: `6a4f33f` (v2.2.1 — Phase 11 shipped + docs catchup)

**Phase 11 commits in review scope**:

- `41adbc4` chore(wave7): orchestration + WAVE_CONTEXT
- `11ff9cd` feat: Foundation (enums + col additions + type stubs)
- `778c62d` feat(wave7-tau): Phase 11A — SEG detection + segmentation
- `10db2f9` feat(wave7-upsilon): Phase 11B — Routing + content sanitizer
- `606fef5` feat(wave7-phi): Phase 11C — Canary deliverability (code)
- `4d72533` docs(wave7-omega-ops): Phase 11C — provider seed pool runbook
- `85f39a0` docs(v2.2.0): docs catch-up + webhook event registration
- `b3aeddf`, `6a4f33f` release commits (release-please, no code changes)

**LOC delta**: 115 files changed, 27,162 insertions, 114 deletions (large: includes
the 74KB Phase 11 spec doc and the 12KB deliverability.md guide as spec/prose;
actual code is ~10-12k LOC).

## Design authority

Full spec is authoritative for what SHOULD be shipped:
`docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md`

Review dimensions verify code against:

1. Phase 11 spec acceptance criteria
2. Wave 5/6 review report standards (`review/CONSOLIDATED.md`) — nothing regressed
3. `CLAUDE.md` conventions (multi-tenancy chokepoint, `.ts` extensions, `orgFn`, etc.)

## The dimensions this review covers

Six review dimensions, one agent per dimension, running in parallel:

| Dim              | Focus                                                                                                                                                                                                                  | Owner                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Security**     | SEG detection (DNS injection?), IMAP credential encryption, provider vs user seed keys split, canary polling auth, webhook event scope, tenant isolation on new tables                                                 | reviewer-security     |
| **Correctness**  | Routing decision table exhaustiveness, canary injection scheduling, auto-pause evaluator, state machine event flow, gateway classification cache TTL/invalidation, anchor-threading exception                          | reviewer-correctness  |
| **Architecture** | Foundation layering respected? `packages/mail` still decoupled from `integrations`? Effect executor extension patterns? Entry-conditions purity? shared helper reuse? No orphaned modules?                             | reviewer-architecture |
| **Performance**  | MX lookup batching + DNS semaphore, canary polling load, `deliverability_snapshot` rollup query, indexes on new tables, N+1 on grid queries                                                                            | reviewer-performance  |
| **Testing**      | Phase 11 test coverage: what's tested, what's not, gaps in critical paths (canary happy path, silent drop detection, auto-pause logic, routing decision table, seed inbox credential encryption/decryption round-trip) | reviewer-testing      |
| **Completeness** | Phase 11 spec acceptance criteria vs shipped code. All 40 tickets truly complete? PR body claims vs code reality? deliverability.md docs match code? webhook events registered AND fanout wired?                       | reviewer-completeness |

## Reviewer rules (identical to V0 review)

- **Read-only.** No PR, no edits. Observe and report.
- **Cite file:line for every finding.** Vague references waste readers' time.
- **Confidence field mandatory.** "I think this is a bug" is honest and useful.
- **Context7 MCP for any library API question** (Better Auth, Drizzle, pg-boss, `imap`/`imapflow`, `ai` SDK, Nango).
- **Zero-tolerance false positives on P1/critical.** Check code twice when flagging.
- **Distinguish "deferred per brief" from "should be there."**
- **Fast-follows aren't bugs.** If the spec says "deferred to Phase 12+", don't flag.

## What each is specifically hunting for

- **Security**: DNS spoofing / cache poisoning of gateway classifications, IMAP credential leakage into logs, workspace admin gaining access to provider-managed seeds, canary poller running with wrong org context, tenant isolation on `seed_inbox`/`canary_send`/`deliverability_snapshot`
- **Correctness**: Routing decision table (5 columns × 7 rows per spec) — all branches implemented? Anchor-threading exception carved out correctly? Content sanitizer preserves valid MIME? Auto-pause threshold logic edge cases? Silent-drop 24h sweep correctly excludes pending canaries?
- **Architecture**: Wave-5 CR-009 (mail → integrations decoupling) preserved? `packages/mail/gateway-detect.ts` clean of DB imports? `packages/core/deliverability/*` genuinely pure? Cross-package type imports use `import type`?
- **Performance**: MX lookup rate limiting effective? Canary polling connection pool reasonable? Grid query aggregation efficient? All hot tables have appropriate indexes? pg_trgm not regressed?
- **Testing**: 15 new test files claimed — actually cover what they claim? Any P1 invariants un-tested (silent-drop detection, auto-pause fires, routing decision matrix)? Load-test canary modes were deferred — noted?
- **Completeness**: Every ticket 11A.1-11A.11, 11B.1-11B.10, 11C.1-11C.14, 11C.15-11C.19 has code that fulfills it? `SUPPORTED_WEBHOOK_EVENTS` includes all 4 Phase 11 events? Fanout wired for those events in the worker? UI actually shows deliverability grid? Docs claims match code?

## Format each dimension's output

Write to `phase11-review/findings/<dimension>.md`:

```markdown
# {Dimension} Review Findings

## Summary

- Files reviewed: ~N
- Critical: 0, High: 0, Medium: 0, Low: 0
- Overall: {ok | needs-fixes | broken}

## Findings

### [{DIM}-001] Title

- **Location**: `path/to/file.ts:lineno`
- **Severity**: critical|high|medium|low
- **Confidence**: high|medium|low
- **What**: One paragraph. What is the code doing wrong?
- **Impact**: What could happen in production or during a review?
- **Fix**: Concrete recommendation.

...

## Positive observations

- Things that are handled well.
```
