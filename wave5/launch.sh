#!/usr/bin/env bash
# ============================================================================
# wave5/launch.sh — Spawn 6 Cursor Composer 2.5 agents in isolated worktrees
# to fix all 85 findings from the V0 review (review/CONSOLIDATED.md).
#
# Tracks:
#   ALPHA   engine safety + CAN-SPAM auto-send + effect executor
#   BETA    OAuth mailboxes + PRD gap-close (timeline, sentiment, entry_condition)
#   GAMMA   security hardening + webhook replay + rate limits
#   DELTA   architecture cleanup + correctness fixes (mail decouple, Graph pagination, cursor bug, CSV async)
#   EPSILON performance indexes + DB client
#   ZETA    testing coverage + tenancy expansion + load-test-in-CI
# ============================================================================
set -uo pipefail
command -v jq >/dev/null || { echo "wave5/launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
# ALPHA is highest-risk (engine); give it more headroom
HARD_TIMEOUT="${HARD_TIMEOUT:-7200}"
OUT="wave5/logs"
BRIEFS="wave5/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'wave5-alpha-engine\twave5/briefs/track-alpha-engine.md'
  $'wave5-beta-oauth-prd\twave5/briefs/track-beta-oauth-prd.md'
  $'wave5-gamma-security\twave5/briefs/track-gamma-security.md'
  $'wave5-delta-architecture\twave5/briefs/track-delta-architecture.md'
  $'wave5-epsilon-performance\twave5/briefs/track-epsilon-performance.md'
  $'wave5-zeta-testing\twave5/briefs/track-zeta-testing.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders (Wave 5)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- **Context7 MCP** for every non-trivial API call. Do NOT rely on training data.
- \`pnpm check\` MUST be **green** before RESULT.json status=ok. Zero lint errors, zero type errors, zero failing tests. If your change breaks an existing test, resolve honestly — do NOT suppress it.
- **File-ownership boundaries in your brief are STRICT.** If a fix truly requires touching a file owned by another track, write \`NEEDS.md\` at the worktree root and mark RESULT status=partial with a note.
- The load test (\`pnpm tsx scripts/load-test-engine.ts\`) must still exit 0 with all invariants holding after your changes. If your track alters engine behavior, EXTEND the load test.
- Migration numbering: if you add schema, run \`pnpm db:generate --name wave5_<track>\`. On merge order, drizzle-kit renumbers.
- Explicit \`.ts\`/\`.tsx\` extensions on relative imports; \`import type\` for type-only.
- Write \`RESULT.json\` at the worktree root when done.

## The stakes

You are fixing bugs found by a full multi-dimensional review of a shipping product. Every finding is real. Do NOT phone in the fixes. Read the source before touching it. Verify with tests. Ship it right the first time."

  echo "[launch] $name (brief: $brief_file)"
  ${TIMEOUT_BIN:+$TIMEOUT_BIN $HARD_TIMEOUT} "$AGENT_BIN" -p --force --trust \
    --worktree "$name" --worktree-base "$BASE" \
    --model "$MODEL" --output-format stream-json --stream-partial-output \
    "$prompt" >"$OUT/$name.jsonl" 2>"$OUT/$name.err" &
  echo $! > "$OUT/$name.pid"
done

sleep 1
for name in "${names[@]}"; do
  sid=""
  for _ in $(seq 1 60); do
    sid="$(grep -m1 '"type":"system"' "$OUT/$name.jsonl" 2>/dev/null | jq -r '.session_id // empty' 2>/dev/null)"
    [[ -n "$sid" ]] && break
    sleep 0.25
  done
  wt="$HOME/.cursor/worktrees/$(basename "$(git rev-parse --show-toplevel)")/$name"
  br="$(git worktree list --porcelain 2>/dev/null | awk -v p="$wt" '/^worktree /{w=$2} /^branch /{b=$2; if(w==p) print b}' | sed 's#refs/heads/##')"
  printf '%s\t%s\t%s\n' "$name" "${br:-$name}" "${sid:-?}" >> "$OUT/manifest.tsv"
done

echo
column -t -s $'\t' "$OUT/manifest.tsv" 2>/dev/null || cat "$OUT/manifest.tsv"
echo
echo "wait    : bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh $OUT --summary /tmp/wave5.json"
