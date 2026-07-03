# PERFORMANCE REVIEW — Phase 11

## Task

Read-only review of the Phase 11 shipped code through the performance lens. Write
findings to `phase11-review/findings/performance.md` following the format in
`phase11-review/CONTEXT.md`.

## Focus areas

### P1 — hot path efficiency

1. **MX lookup batching + throttling**
   - `apps/worker/src/handlers/gateway-detect.ts`:
     - Verify DNS semaphore (spec: max 50 concurrent MX lookups per worker process)
     - Batch import path: 5,000-prospect CSV → does it hit DNS 5,000 times or dedupe by domain first?
     - Per-domain caching in `gateway_classification` — verify SELECT before enqueue (cache hit path skips DNS)
   - `resolveMx` timeout — is there a hard timeout (5s per lookup)? What happens on stall?

2. **Canary polling load**
   - `apps/worker/src/handlers/canary-check.ts` runs every 5 minutes:
     - Verify one IMAP connection per seed inbox (not one per canary)
     - Verify pending-canary query is indexed (does `canary_send` have `(seed_inbox_id, arrival_status)` index?)
     - Verify per-seed poll respects idle 30-min heartbeat vs 5-min active-canary poll from spec
     - IMAP connection pooling? Or fresh connect every 5 min?

3. **Deliverability grid query** (`getDeliverabilityGrid`)
   - The grid renders rows × cols with delivery %. Query aggregation:
     - Does it JOIN `canary_send` × `seed_inbox` × `mailbox` per cell? Or single aggregation query?
     - Cursor / window boundary correct?
     - Runs every 30 seconds from the UI (polling per spec) — is the query < 100ms at 1k canaries/window?

4. **Auto-pause sweep** (`maybePauseCampaigns` in canary-check.ts)
   - Runs after every 5-min poll cycle
   - Aggregation query per active sequence — how many DB round trips per cycle?
   - Would this scale to 1,000 active sequences? 10,000 canaries?

### P1 continued — indexes

5. **New table indexes**
   - `gateway_classification`: verify `(email_domain)` unique index + `(ttl_until)` for sweep query
   - `seed_inbox`: verify `(organization_id, active)` index for listSeedInboxes; `(organization_id NULL WHERE ...)` for provider seeds
   - `canary_send`: verify `(seed_inbox_id, arrival_status)` for pending-canary lookup, `(sequence_id)` for auto-pause aggregation, `(sent_at)` for silent-drop sweep
   - `deliverability_snapshot`: verify `(organization_id, window_start DESC)` for grid query + unique `(organization_id, mailbox_id, gateway, window_start)` for upsert

6. **Extended prospect index**
   - `prospect_org_gateway_idx` — Foundation added this. Verify partial WHERE clause is correct and this index actually gets used for filter queries

7. **Enrollment / mailbox extensions**
   - `mailbox.enterprise_safe` — needed by routing selector. Any index? Or is scan-all-workspace-mailboxes fine?
   - If mailbox count per workspace < 20, scan is fine. Note this.

### P2 — micro-optimizations

8. **Advisory lock scope in reserve-slot**
   - UPSILON added SEG throttle + 5-min domain gap inside the advisory lock
   - Verify the added work doesn't extend lock hold time excessively
   - The per-domain gap query — is it indexed on `(mailbox_id, recipient_domain, reserved_at)`?

9. **Content sanitizer allocation**
   - `sanitizeForSeg` — does it clone the whole MIME string, or edit in place / streaming?
   - For a 500KB MIME, is memory usage sane?

10. **`generateEmail` still using metadata tuple**
    - Wave 5 DELTA CR-011 established the `{model, modelId, provider}` tuple. Any Phase 11 code that regresses to string model IDs?

11. **Canary send effects overhead**
    - Canary sends go through same `send_reservation` + throttle as real sends. Verify canary sends don't count toward the workspace's real daily cap (they're a shadow — should be tracked separately or excluded from real caps)

### P3 — informational

12. **`pnpm check` runtime regression**
    - Phase 11 added 15 test files. Verify total test suite runtime hasn't degraded past ~30s (per Wave 6 CI numbers)
    - Load-test canary modes were declared but not wired (my session-note). Verify no perf impact from unused switch cases

13. **Bundle size regression**
    - Added Deliverability grid UI (Recharts already imported). Grid + settings pages — bundle size delta?

## Do

- Look for `.findFirst`, `.findMany`, and raw SQL in the new handlers — count query round-trips per cycle
- Grep for `for (const ... of ...)` inside handlers — any N+1 patterns?
- Check EXPLAIN plans mentally for the grid query + auto-pause query

## Reference

- Phase 11 spec: `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` — Mechanics + Rate limiting sections
- Wave 5 performance review (baseline): `review/findings/performance.md`
- EPSILON's Wave 5 indexes — verify no regressions
