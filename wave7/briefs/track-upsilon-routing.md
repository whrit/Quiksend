# TRACK UPSILON — Phase 11B: Routing

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/wave7-upsilon-routing` from `main` (worktree isolated).

**Foundation wave has already merged.** The shared enums + `mailbox.enterprise_safe`
column + `mailbox-safety.ts` helper are in place. You implement the routing
decision logic + content sanitizer + settings UI on top.

## Context (read in order)
1. `CLAUDE.md`
2. `wave7/WAVE_CONTEXT.md` — file-ownership boundaries
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Phase 11B (full section)
4. `packages/core/src/deliverability/mailbox-safety.ts` — Foundation's helper you import
5. `packages/mail/src/gateway-detect.ts` — Foundation's type stub; TAU implements real logic (may not be merged yet — reference types only)
6. `apps/worker/src/sequence/reserve-slot.ts` — Wave 5 ALPHA's atomic reservation; the extension point
7. `apps/worker/src/sequence/effects.ts` — Wave 5 ALPHA's effects; extension for sanitizer call
8. `packages/mail/src/mime.ts` — where sanitizer plugs in before MIME build
9. `packages/core/src/state-machine/transition.ts` + `types.ts` — event catalog you extend

## Tickets from Phase 11 spec (11B.1 through 11B.10)

### 11B.1 — Migration
Extend `send_reservation` with `recipient_domain text` if not present. Migration slot 0017.
Also add the workspace-level policy shape to `organization.metadata.deliverability` — this is
a jsonb structure, no SQL migration needed for that part.

### 11B.2 — Routing selector
NEW module `apps/worker/src/sequence/mailbox-router.ts`. Full implementation per spec § Phase 11B Mechanics:

```typescript
export type RoutingDecision =
  | { kind: "route"; mailboxId: string; autoSwapped: boolean }
  | { kind: "skip"; reason: "no_safe_mailbox_for_gateway" | "policy_off_but_warn"; emitEvent: true };

export async function selectMailboxForSend(
  tx: DrizzleTx,
  orgId: string,
  enrollment: Enrollment,
  recipientGateway: EmailGateway | null,
  policy: DeliverabilityPolicy,
): Promise<RoutingDecision>;
```

Implement the full decision table from the spec (5 policy states × gateway type × safe-mailbox
existence × current mailbox safety). Use `isMailboxSafeForGateway` from `@quiksend/core`.

**Anchor threading exception (critical from spec)**: if `enrollment.anchor_message_id IS NOT NULL`,
skip auto-swap. Fall through to "keep current mailbox + emit event" — threading integrity beats
routing optimization.

**Auto-swap safe-mailbox selection**: among safe mailboxes, pick least-loaded (24h send count).
Same-provider preference (M365→M365 over M365→SMTP).

Unit tests exhaustively cover the decision table + anchor exception + auto-swap ranking.

### 11B.3 — Content sanitizer
NEW module `packages/mail/src/content-sanitizer.ts`:

```typescript
export function sanitizeForSeg(mime: BuiltMime, options: {
  stripTrackingPixel: boolean;
  stripExternalImages: boolean;
  preferPlainText: boolean;
}): BuiltMime;
```

- Strip tracking pixel: `<img>` matching Quiksend's tracking domain (from env or config)
- Strip external images: remove or inline as base64 (only <100KB)
- Prefer plain text: `multipart/alternative` with text/plain first, drop HTML part

Unit tests per transformation.

### 11B.4 — Throttle + 5-min per-domain gap
Extend `reserve-slot.ts`:
- Add per-mailbox per-gateway sub-cap. `SEG_DAILY_CAP_PER_MAILBOX` env (default 50)
- Add 5-min per-recipient-domain gap check inside the advisory lock. If violated, defer via `schedule_at`.

Update `send_reservation` inserts to populate `recipient_domain` (extracted from recipient email).

### 11B.5 — Server functions (all `orgFn`)
Add to `apps/web/src/lib/mailboxes.functions.ts`:
- `setMailboxEnterpriseSafe({ mailboxId, safe, reason? })` — admin role gate
- `getWorkspaceDeliverabilityPolicy({})` → policy jsonb
- `setWorkspaceDeliverabilityPolicy({ routingPolicy, contentSanitizerEnabled? })` — admin only
- `previewRoutingImpact({})` → prospect + mailbox counts per spec

### 11B.6 — Mailbox settings toggle + reason field
Extend `apps/web/src/routes/_protected/settings/mailboxes/index.tsx` — each mailbox row
gets a new "Enterprise-safe" toggle. On-click opens confirmation modal per spec.

### 11B.7 — Workspace deliverability settings page
NEW route `apps/web/src/routes/_protected/settings/deliverability.tsx`. Full policy
UI per spec:
- Radio group: routing policy (off/warn/enforce)
- Checkbox: content sanitizer
- Preview panel: `previewRoutingImpact` numbers live-updating on radio change
- Save button with confirmation modal for off→enforce transition

**Coordination with PHI**: PHI will extend this same file by adding a canary section
BELOW your routing section. Structure the file so PHI can `INS.POST` a new section
without touching your existing sections. Use a clear section boundary comment:

```tsx
{/* === Phase 11B Routing section === */}
<RoutingSection />
{/* === End Phase 11B === */}

{/* === Phase 11C Canary section (PHI extends here) === */}
```

### 11B.8 — Warning banners
- Sequence detail (`_protected/sequences/$id/index.tsx`): red banner when sequence has SEG-tagged prospects AND no enterprise-safe mailbox exists
- Enrollment dialog (Wave 5 BETA's dialog): inline warning when selection includes SEG-tagged prospects and no safe mailbox

### 11B.9 — State machine extension
Extend `packages/core/src/state-machine/transition.ts`:
- New event kind `{ kind: "no_safe_mailbox", at: Date }`
- Transition from `active` on `no_safe_mailbox` → `paused` with effects `[emit_event { type: "enrollment.no_safe_mailbox_for_gateway" }]`

**PHI also extends transition.ts** — coordinate on adjacent case branches. Do NOT
overwrite PHI's new event kinds. If a merge conflict happens, take both branches.

### 11B.10 — Integration test
End-to-end: enroll 20 prospects behind Proofpoint, 0 safe mailboxes, policy = "enforce" →
assert all 20 pause with `enrollment.no_safe_mailbox_for_gateway` event. Add a safe mailbox
→ resume enrollments manually → assert they route to it.

## Documentation lookup (mandatory)
Context7 MCP for:
- **Drizzle ORM** — advisory locks, jsonb path queries, conditional inserts
- **Better Auth** — admin role check middleware pattern (Wave 5 SEC-007 established this)
- **shadcn Sheet + Dialog + Popover** — for the deliverability settings + warning modals

## Files owned (strict)

- `packages/db/src/schema/mail.ts` (send_reservation extension; NO mailbox column changes — Foundation did those)
- `packages/db/drizzle/0017_phase11b_routing.sql` (renumbers if merge order shifts)
- `packages/mail/src/content-sanitizer.ts` (NEW)
- `packages/mail/src/content-sanitizer.test.ts` (NEW)
- `packages/mail/src/index.ts` (add sanitizer export)
- `packages/core/src/state-machine/transition.ts` (extends — coordinate with PHI)
- `packages/core/src/state-machine/transition.test.ts` (extends)
- `packages/core/src/state-machine/types.ts` (extends Event union with `no_safe_mailbox`)
- `apps/worker/src/sequence/reserve-slot.ts` (extends for SEG throttle + per-domain gap)
- `apps/worker/src/sequence/reserve-slot.test.ts` (extends)
- `apps/worker/src/sequence/effects.ts` (extends for sanitizer call — coordinate with PHI who also touches this file)
- `apps/worker/src/sequence/mailbox-router.ts` (NEW)
- `apps/worker/src/sequence/mailbox-router.test.ts` (NEW)
- `apps/worker/src/sequence/execute-step.ts` (extends — inject routing selector call)
- `apps/web/src/lib/mailboxes.functions.ts` (extends — server-fns)
- `apps/web/src/lib/organization.functions.ts` (extends for workspace policy CRUD — may not exist; create if needed)
- `apps/web/src/routes/_protected/settings/mailboxes/index.tsx` (mailbox toggle)
- `apps/web/src/routes/_protected/settings/deliverability.tsx` (NEW — routing section only; PHI extends)
- `apps/web/src/routes/_protected/sequences/$id/index.tsx` (warning banner — coordinate with TAU + PHI on adjacent sections)
- Any enrollment dialog file (from Wave 5 BETA) — locate + extend

## Do NOT touch

- `packages/db/src/schema/prospects.ts` — TAU
- `packages/db/src/schema/deliverability.ts` — TAU created for gateway_classification; PHI will extend with canary tables
- `packages/mail/src/gateway-detect.ts` — TAU (real impl)
- `apps/worker/src/handlers/gateway-detect.ts` — TAU
- `apps/worker/src/handlers/canary-check.ts` — PHI
- `apps/web/src/lib/prospects.functions.ts` — TAU
- `apps/web/src/routes/_protected/prospects/**` — TAU
- `apps/web/src/routes/_protected/deliverability/**` — PHI
- `packages/core/src/state-machine/entry-conditions.ts` — TAU
- `packages/core/src/deliverability/mailbox-safety.ts` — Foundation shipped; import only

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
pnpm tsx scripts/load-test-engine.ts  # still passes
```

Extend load test with `--test-mode=seg-routing`: 100 SEG-tagged prospects, 2 safe mailboxes,
2 unsafe. Verify routing + SEG sub-cap holds + 5-min per-domain gap holds.

Manual smoke:
- Toggle a mailbox's `enterprise_safe` flag, verify UI update + DB persistence
- Toggle workspace policy to "enforce" with 0 safe mailboxes, enroll prospects behind SEG, verify pause + event

## Result

```json
{
  "status": "ok",
  "track": "UPSILON",
  "phase_section": "11B",
  "tickets_completed": ["11B.1", ..., "11B.10"],
  "files_changed": [...],
  "tests_added": [...],
  "notes": "..."
}
```
