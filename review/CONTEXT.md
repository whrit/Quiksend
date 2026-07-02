# Full V0 Review — Shared Context

## Scope

**All work between v1.0.3 baseline and v2.0.0 (V0 DoD milestone).**

- Baseline commit: `18d0abb` (pre-foundations release 1.0.3)
- HEAD commit: `898c7f7` (release 2.0.0)
- 39 commits, 283 files, ~68k LOC added
- 10 packages (7 new since baseline), 2 apps (heavily extended)

## What shipped (V0 features)

| Phase       | Version          | Scope                                                                                                                    |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Foundations | v1.1.0           | `packages/{core,mail,integrations,queue,observability}` + `orgFn` tenancy chokepoint + shadcn breadth + tenancy CI guard |
| 2           | v1.2.0           | Prospects + companies + CSV import wizard (papaparse streaming)                                                          |
| 3           | v1.3.0           | Nango wrapper + inbound CRM sync (Salesforce + HubSpot)                                                                  |
| 4-back      | v1.4.0           | Mailboxes + SMTP adapter + compose + single send                                                                         |
| 5           | v1.5.0           | Sequence model + dnd-kit builder + enrollment                                                                            |
| 4-rem       | v1.6.0           | Gmail + Microsoft Graph adapters + full DKIM check                                                                       |
| 6           | v1.7.0           | Scheduler engine (LOAD-TESTED: zero double-sends)                                                                        |
| 7-prep      | v1.8.0           | DSN bounce parser + inbound matcher + auto-reply detector                                                                |
| 8-prep      | v1.9.0           | packages/ai + pgvector schema + value_prop CRUD                                                                          |
| 7           | v1.10.0          | Inbound poller + suppression + unified inbox UI                                                                          |
| 8           | v1.11.0          | AI research + generation + humanizer + review UI                                                                         |
| 9           | v1.12.0          | CRM writeback (idempotent) + analytics dashboards                                                                        |
| 10          | v1.13.0 / v2.0.0 | Public REST API + HMAC webhooks + hardening + docs                                                                       |

## Load-bearing invariants each reviewer must confirm

1. **Tenancy chokepoint**: every data-touching server-fn composes `authMiddleware` from `apps/web/src/lib/org-fn.ts`. Every app-scoped query filters by `context.orgContext.organizationId`. The regex CI guard (`packages/db/src/tenancy-guard.test.ts`) lists `APP_SCOPED_TABLES` — verify no table missing.
2. **Engine safety** (Phase 6, `apps/worker/src/sequence/`):
   - `SELECT ... FOR UPDATE SKIP LOCKED` in scheduler tick — 2 workers never claim the same enrollment
   - `pg_advisory_xact_lock(mailboxId)` around slot reservation — atomic per-mailbox cap enforcement
   - `idempotency_key = SHA-256(enrollmentId || stepId || attempt)` — retried jobs never double-send
3. **Manual-first anchor**: `captureManualAnchor` (Phase 6) transitions `waiting_manual → active`, captures RFC Message-Id, threads follow-ups under it. All follow-ups sent from same mailbox with `In-Reply-To`/`References` + provider `threadId`.
4. **Thread matching** (Phase 7): `normalizeMessageId` canonicalizes for cross-provider matching. Priority: In-Reply-To → References chain → providerThreadId → subject heuristic.
5. **Bounce classification** (Phase 7-prep): `parseBounce` distinguishes hard (5.x.x, "user unknown") from soft (4.x.x, "over quota"). Hard bounce → terminate enrollment + insert `suppression`.
6. **Idempotent CRM writeback** (Phase 9): `crm_writeback_log.idempotency_key` unique — replayed job doesn't create duplicate Task/Engagement.
7. **HMAC webhook signing** (Phase 10): `signWebhook(payload, secret)` uses timestamp-nonce'd HMAC-SHA256 to prevent replay. Receivers verify `abs(now - ts) < 300s`.
8. **Unsubscribe end-to-end** (Phase 10): `mintUnsubscribeToken` → `List-Unsubscribe` header → `/api/v1/unsubscribe?token=` → verify → suppression row → CRM status writeback.
9. **API key scoping**: keys resolve to `{ orgId }`; requests from org A never see org B's data.
10. **Prompt injection safety** (Phase 8): scraped web content treated as untrusted; system prompt says "only ground claims in cited_facts"; Zod schema constrains output.

## What we're reviewing FOR

- **Completeness**: does implementation match Phase 2-10 briefs + PRD § 4-14?
- **Correctness**: do the invariants above actually hold? Any bugs?
- **Alignment**: shape/naming/patterns consistent with foundations + CLAUDE.md conventions?
- **Bugs/Issues**: real defects that would surface in production

## Deliverable per reviewer

Write findings to `review/findings/{dimension}.md` in this shape:

```markdown
# {Dimension} Review Findings

## Summary

- Files reviewed: N
- Critical: N, High: N, Medium: N, Low: N
- Overall: {ok | needs-fixes | major-concerns}

## Findings

### [{DIM}-001] {short title}

- Location: `path/to/file.ts:line-range`
- Severity: critical | high | medium | low
- What: {what the issue is, with quoted code if helpful}
- Impact: {what could go wrong / who's affected}
- Fix: {concrete recommendation}
- Confidence: high | medium | low (in how sure you are this is real)

### [{DIM}-002] ...
```

Do NOT fix anything. Only observe + report. Consolidation happens in `review/CONSOLIDATED.md` after all reviewers are done.

## Ground rules for reviewers

- **Read source code, not the PR body or brief.** Briefs are aspirational; find drift.
- **Cite `file:line` for every finding.** Vague "somewhere in packages/mail" is useless.
- **Confidence levels matter.** Say "confidence: low" if you're unsure — better than a false positive.
- **Distinguish "was skipped" from "was wrong."** A brief may say a feature is deferred; that's not a bug.
- **Zero-tolerance false positives on P1 invariants.** If you flag "SKIP LOCKED not used" — quote the SQL. If you flag "no HMAC verify" — show the code path.
- **NEVER cite from your training data.** Use Context7 MCP for library docs.
- **Don't fix.** Report only.

## Grep starting points

```
Tenancy chokepoint: grep -rn 'authMiddleware' apps/web/src/lib/
Engine claim SQL:  grep -rn 'FOR UPDATE SKIP LOCKED' apps/worker/
Reserve slot:      apps/worker/src/sequence/reserve-slot.ts
Idempotency:       grep -rn 'idempotency_key' packages/ apps/
Message-Id normalize: packages/mail/src/threading.ts
Bounce parser:     packages/mail/src/bounce.ts
CRM writeback:     packages/integrations/src/writeback/
Webhook signing:   grep -rn 'signWebhook\|X-Quiksend-Signature' apps/ packages/
Unsubscribe:       packages/mail/src/unsubscribe.ts + apps/web/src/routes/api/v1/unsubscribe.ts
API key resolution: grep -rn 'resolveApiKey' apps/web/
AI prompt safety:  packages/ai/src/generation/ + packages/ai/src/research/
```
