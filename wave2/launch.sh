#!/usr/bin/env bash
# ============================================================================
# wave2/launch.sh — Spawn Wave-2 Cursor Composer agents in isolated worktrees:
#   - phase-5-sequences        (Track E)
#   - phase-4-gmail-graph      (Track F)
#
# Wave 1 (Phase 2, 3-back, 4-back) must be MERGED to main first — Wave 2
# schemas FK to prospect/mailbox tables and the adapters build on the smtp
# reference. Run after all three Wave-1 PRs land.
# ============================================================================
set -uo pipefail
command -v jq >/dev/null || { echo "launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-5400}"
OUT="wave2/logs"
BRIEFS="wave2/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'phase-5-sequences\twave2/briefs/phase-5-sequences.md'
  $'phase-4-gmail-graph\twave2/briefs/phase-4-remainder-gmail-graph.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- Fetch current docs for every non-trivial package call via **Context7 MCP** — Drizzle, TanStack Start, @dnd-kit/*, @nangohq/node, Gmail API v1, Microsoft Graph, Zod v4. Do NOT rely on training data.
- \`pnpm check\` must be **green** before writing RESULT.json status=ok. Zero lint errors, zero type errors, zero failing tests.
- File-ownership boundaries in \`wave2/WAVE_CONTEXT.md\` are STRICT.
- Explicit \`.ts\`/\`.tsx\` extensions, \`import type\` for type-only.
- Write \`RESULT.json\` at the worktree root when done."

  echo "[launch] $name"
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
echo "wait    : bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh $OUT --summary /tmp/wave2.json"
