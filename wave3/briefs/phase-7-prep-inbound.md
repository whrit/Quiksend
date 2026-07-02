# PHASE-7-PREP: Inbound-matching + DSN/bounce parser — Track H

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`feat/phase-7-prep-inbound` from `main` (worktree isolated).

## Context
Read at repo root first:
1. `CLAUDE.md`
2. `WAVE_CONTEXT.md` (root + wave3)
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phases-2-10.md` — Phase 7 section
4. `packages/mail/src/threading.ts` — `normalizeMessageId`, `parseReferences`

This is a pure-logic side-quest running in parallel with Phase 6 engine (Track G).
No engine dependency. Ships pure modules Phase 7 proper (Wave 4) wires up.

## Documentation lookup (mandatory)
Context7 MCP for:
- **RFC 3464** — Multi-part DSN report format
- **RFC 8098** — Delivery Status Notification format specifics
- **mailparser** — parsedMail shape (headers, attachments, embedded content)

## Tasks

### T1 — Bounce/DSN parser (`packages/mail/src/bounce.ts`)

```ts
export interface ParsedBounce {
  type: "hard" | "soft";
  statusCode: string | null;      // RFC 3463 X.Y.Z code (e.g., "5.1.1")
  recipient: string | null;
  diagnostic: string | null;
  provider: "gmail" | "microsoft" | "smtp" | "unknown";
}

export function parseBounce(rawMime: string): ParsedBounce | null
```

Detects:
- **RFC 3464 multipart/report** with `content-type: message/delivery-status` —
  parse `Status:` + `Original-Recipient:` + `Diagnostic-Code:` headers
- **Provider-specific formats**:
  - Gmail: `From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>` + specific
    text patterns
  - Microsoft Graph: NDR headers `X-Failed-Recipients:`, `x-postmaster-msguid:`
  - Generic SMTP: `Subject: Undeliverable:` + reply text patterns

Classification:
- Status code starting with `5.` → hard bounce
- Status code starting with `4.` → soft bounce
- No status code, but subject/text matches "user unknown"/"no such user" → hard
- No status code but "over quota"/"mailbox full" → soft

Returns `null` when the raw MIME is not a bounce.

### T2 — Bounce corpus (`packages/mail/src/bounce.samples/`)

Real-world bounce fixtures — collect ~15 samples covering:
- Gmail user-unknown (hard)
- Gmail over-quota (soft)
- Gmail spam-blocked (hard)
- Microsoft NDR user-unknown (hard)
- Microsoft NDR MX config (soft)
- Generic SMTP 550 (hard)
- Generic SMTP 452 (soft)
- Postfix double-bounce
- Auto-reply that ISN'T a bounce (must return null)
- Vacation OOO that ISN'T a bounce (must return null)
- Legitimate reply that ISN'T a bounce (must return null)

Store as `bounce-<n>-<description>.eml` files. Exhaustively test in
`packages/mail/src/bounce.test.ts`:
```ts
for (const sample of samples) {
  it(sample.name, () => {
    const raw = readFileSync(sample.path, "utf8");
    const parsed = parseBounce(raw);
    expect(parsed?.type).toBe(sample.expected.type);
    // etc.
  });
}
```

### T3 — Inbound matching (`packages/mail/src/inbound-matching.ts`)

```ts
export interface InboundMatch {
  outboundMessageIdHeader: string;   // the RFC Message-Id VALUE (angle brackets)
  matchType: "in_reply_to" | "references" | "thread_id" | "subject_heuristic";
  confidence: "high" | "medium" | "low";
}

export function extractCandidateIds(inbound: {
  inReplyTo: string | null;
  references: string | null;
  providerThreadId: string | null;
  subject: string | null;
}): {
  normalizedInReplyTo: string | null;
  normalizedReferences: string[];
  providerThreadId: string | null;
}

export function matchInbound(
  inbound: { inReplyTo, references, providerThreadId, subject },
  outboundAnchors: { messageIdHeader: string; providerThreadId: string | null; subject: string | null }[],
): InboundMatch | null
```

Matching strategy (in priority order):
1. **`In-Reply-To` == outbound `message_id_header`** — high confidence
2. **Any `References` chain entry == outbound `message_id_header`** — high
3. **`providerThreadId` == outbound `provider_thread_id`** — high (works when a
   client rewrites Message-Id but preserves Gmail threadId)
4. **Subject heuristic**: strip leading `Re:`/`Fwd:` from both sides, compare
   case-insensitively; medium confidence. Only used as a fallback and callers
   should log the low-confidence match.

All Message-Id comparisons use `normalizeMessageId` from `threading.ts` (so
angle-bracket + case variations don't cause misses).

### T4 — Unit tests (`packages/mail/src/inbound-matching.test.ts`)

- Match on In-Reply-To (happy path)
- Match on References mid-chain
- Match on providerThreadId when Message-Id doesn't line up (mobile client scenario)
- Subject heuristic match
- No match returns null
- Multiple outbound anchors — matches the correct one, not the first
- Malformed inbound headers (empty, whitespace, garbage) — returns null cleanly

### T5 — Auto-reply detector (`packages/mail/src/auto-reply.ts`)

Pure module:
```ts
export interface AutoReplyDetection {
  isAutoReply: boolean;
  reason: "auto_submitted" | "x_autoreply" | "text_heuristic" | null;
}

export function detectAutoReply(headers: Record<string, string>, bodyText: string | null): AutoReplyDetection
```

Header checks (any hit → auto-reply):
- `Auto-Submitted: auto-replied` / `auto-generated`
- `X-Autoreply: yes`
- `X-Autorespond`
- `Precedence: auto_reply` or `bulk` or `list`

Text heuristics (only checked if headers didn't trigger):
- "out of office"
- "vacation"
- "currently away"
- "I will respond when I return"

Unit tests covering: all header triggers, text-only triggers, false positives
(a real reply that mentions "vacation" as topic).

## Constraints
- **Touch ONLY**:
  - `packages/mail/src/bounce.ts` (new)
  - `packages/mail/src/bounce.test.ts` (new)
  - `packages/mail/src/bounce.samples/*.eml` (new)
  - `packages/mail/src/inbound-matching.ts` (new)
  - `packages/mail/src/inbound-matching.test.ts` (new)
  - `packages/mail/src/auto-reply.ts` (new)
  - `packages/mail/src/auto-reply.test.ts` (new)
  - `packages/mail/src/index.ts` (add exports)
- **DO NOT** touch `packages/mail/src/{adapter,mime,threading,compliance}.ts` — foundations owns them
- **DO NOT** wire these into the poller — that's Phase 7 proper (Wave 4)
- Context7 MCP for mailparser, RFC 3464

## Result
```json
{
  "status": "ok",
  "files": ["packages/mail/src/bounce.ts", "..."],
  "notes": "Phase 7 prep complete. pnpm check green. Bounce corpus of 15 samples all classified correctly. Inbound matcher handles In-Reply-To/References/threadId with subject heuristic fallback. Auto-reply detector avoids false positives on real replies mentioning 'vacation'."
}
```
