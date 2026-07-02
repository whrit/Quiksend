# FOUNDATION — Phase 11 shared schema + type foundations

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`chore/phase-11-foundation` from `main` (worktree isolated).

## Context (read in order)
1. `CLAUDE.md`
2. `wave7/WAVE_CONTEXT.md`
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` — Consolidated entity map section (top) + Phase 11A/B/C data model sections
4. `packages/db/src/schema/prospects.ts`, `mail.ts`, `sequences.ts` — the existing tables you extend
5. `packages/core/src/state-machine/transition.ts` + `types.ts` — the state machine you don't touch but reference

## Goal

Ship the minimum shared foundation that Wave 7.1's three code tracks (TAU, UPSILON,
PHI) all reference. Nothing more. This wave lands **fast** (~30 min) and merges to
main before Wave 7.1 launches, so the three parallel tracks don't race on the same
enum + column names.

**Explicit non-goal**: do NOT implement any Phase 11 logic. Only stubs + schema +
type definitions.

## What ships

### 1. Enums (3 new)

Add to `packages/db/src/schema/prospects.ts` or a new
`packages/db/src/schema/deliverability-enums.ts` (your choice — pick whichever keeps
the barrel clean). Enums:

```typescript
export const gatewayTypeEnum = pgEnum("gateway_type", [
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
  "google_workspace",
  "microsoft_365",
  "zoho",
  "fastmail",
  "other",
  "unknown",
]);

export const canaryArrivalStatusEnum = pgEnum("canary_arrival_status", [
  "pending",
  "arrived_inbox",
  "arrived_spam",
  "arrived_quarantine",
  "silent_drop",
  "bounced",
]);

export const seedInboxPoolTagEnum = pgEnum("seed_inbox_pool_tag", [
  "production",
  "canary_only",
  "warmup",
]);
```

Re-export from `packages/db/src/schema/index.ts`.

### 2. Column additions to `prospect`

Extend `packages/db/src/schema/prospects.ts` `prospect` table with:

```typescript
emailGateway: gatewayTypeEnum("email_gateway"), // nullable
gatewayClassifiedAt: timestamp("gateway_classified_at", { withTimezone: true }),
gatewayEvidence: jsonb("gateway_evidence").$type<GatewayEvidence[]>(),
```

Also add composite index for gateway-filter queries:

```typescript
index("prospect_org_gateway_idx")
  .on(t.organizationId, t.emailGateway)
  .where(sql`${t.emailGateway} IS NOT NULL AND ${t.deletedAt} IS NULL`),
```

### 3. Column additions to `mailbox`

Extend `packages/db/src/schema/mail.ts` `mailbox` table with:

```typescript
enterpriseSafe: boolean("enterprise_safe").notNull().default(false),
enterpriseSafeReason: text("enterprise_safe_reason"),
enterpriseSafeDeclaredAt: timestamp("enterprise_safe_declared_at", { withTimezone: true }),
enterpriseSafeAutoDowngraded: boolean("enterprise_safe_auto_downgraded").notNull().default(false),
```

### 4. Type definition for `GatewayEvidence`

Add to `packages/mail/src/gateway-detect.ts` (NEW file — types-only stub):

```typescript
// packages/mail/src/gateway-detect.ts
// Phase 11A entry point — real implementation ships in Track TAU.
// This file exists so Track UPSILON and Track PHI can import types without
// waiting on TAU's implementation.

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

/**
 * Detect the email gateway for the given email address.
 *
 * Track TAU (Phase 11A) implements this. Foundation ships a stub that throws so
 * consumers can import the type + reference the symbol at type-check time.
 */
export async function detectEmailGateway(_email: string): Promise<GatewayDetectionResult> {
  throw new Error("Phase 11A not yet implemented — see docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md");
}
```

### 5. `mailbox-safety` shared helper

Add `packages/core/src/deliverability/mailbox-safety.ts` (NEW file):

```typescript
import type { EmailGateway } from "@quiksend/mail/gateway-detect";

/**
 * Snapshot of the mailbox fields used to decide safety. Keeps this module
 * pure (no Drizzle imports).
 */
export interface MailboxSafetySnapshot {
  enterpriseSafe: boolean;
  enterpriseSafeAutoDowngraded: boolean;
  provider: "gmail" | "microsoft" | "smtp";
}

/**
 * A mailbox is safe for a gateway if:
 *  - Recipient is not behind a SEG (google_workspace, microsoft_365, or unknown) → any mailbox OK
 *  - Recipient is behind a SEG → mailbox must be enterprise_safe AND not auto-downgraded
 *
 * Both Track UPSILON (routing decision at send time) and Track PHI (auto-downgrade
 * logic in canary auto-pause) call this. Sharing the helper prevents two subtly-
 * different implementations from drifting apart.
 */
export function isMailboxSafeForGateway(
  mailbox: MailboxSafetySnapshot,
  gateway: EmailGateway | null,
): boolean {
  if (gateway === null || gateway === "google_workspace" || gateway === "microsoft_365" || gateway === "unknown") {
    return true;
  }
  return mailbox.enterpriseSafe && !mailbox.enterpriseSafeAutoDowngraded;
}

/**
 * SEG gateways that trigger routing decisions. Excludes google_workspace,
 * microsoft_365, unknown, other.
 */
export const SEG_GATEWAYS: readonly EmailGateway[] = [
  "proofpoint",
  "mimecast",
  "barracuda",
  "cisco_ironport",
  "trend_micro",
  "fortinet",
  "sophos",
  "symantec",
] as const;

export function isSegGateway(gateway: EmailGateway | null): boolean {
  return gateway !== null && (SEG_GATEWAYS as readonly EmailGateway[]).includes(gateway);
}
```

Add corresponding test `packages/core/src/deliverability/mailbox-safety.test.ts` covering:
- All 4 combinations of (mailbox safe/unsafe, gateway SEG/non-SEG) → correct boolean
- Auto-downgraded overrides enterprise_safe
- `isSegGateway` returns true for all 8 SEG types, false for storage providers

### 6. Migration

Run `pnpm db:generate --name phase11_foundation` after the schema changes.
Verify the generated migration:
- Creates the 3 enums
- Adds 3 columns to `prospect` + the composite index
- Adds 4 columns to `mailbox`
- Nothing else

The file should be `packages/db/drizzle/0015_phase11_foundation.sql` (or 0016 if
your local main is ahead — verify with `ls packages/db/drizzle/*.sql | tail -3`).

## Documentation lookup (mandatory)
Context7 MCP for:
- **Drizzle ORM v0.45** — `pgEnum` syntax, `boolean().notNull().default(false)`, jsonb `$type<T>()`
- **Drizzle-kit** — generate migration ordering, journal file

## Files owned (strict)

- `packages/db/src/schema/prospects.ts` (extends `prospect`)
- `packages/db/src/schema/mail.ts` (extends `mailbox`)
- `packages/db/src/schema/deliverability-enums.ts` (NEW, optional if you keep enums in the two tables' files)
- `packages/db/src/schema/index.ts` (barrel re-exports)
- `packages/db/drizzle/0015_phase11_foundation.sql` (or next slot) + snapshot + journal
- `packages/mail/src/gateway-detect.ts` (NEW stub)
- `packages/mail/src/index.ts` (export `EmailGateway` + `GatewayEvidence`)
- `packages/core/src/deliverability/mailbox-safety.ts` (NEW)
- `packages/core/src/deliverability/mailbox-safety.test.ts` (NEW)
- `packages/core/src/deliverability/index.ts` (NEW barrel)
- `packages/core/package.json` — add `@quiksend/mail` workspace dep if not present (for the type import)

## Do NOT touch

- `packages/db/src/schema/{sequences,ai,tasks,writeback,api,security}.ts`
- Any other module — implementation ships in Wave 7.1

## Verification

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm check                            # green
```

The check should pass with all new types + stubs compiling. Existing tests continue
passing. New `mailbox-safety.test.ts` passes.

## Result

```json
{
  "status": "ok",
  "track": "FOUNDATION",
  "phase_section": "foundation",
  "tickets_completed": ["phase11.foundation"],
  "files_changed": [...],
  "tests_added": ["packages/core/src/deliverability/mailbox-safety.test.ts"],
  "notes": "Enums + column additions + shared helper stub shipped. All 3 downstream tracks can now import gateway_type + EmailGateway + GatewayEvidence + isMailboxSafeForGateway. Migration slot 0015."
}
```
