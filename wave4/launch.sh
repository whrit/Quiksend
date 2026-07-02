#!/usr/bin/env bash
# ============================================================================
# wave4/launch.sh — Spawn four Wave-4 Cursor Composer agents in isolated
# worktrees (Phases 7, 8, 9, 10 proper). Fires after Wave 3 (Phase 6 engine +
# Phase 7/8-prep side-quests) is merged.
# ============================================================================
set -uo pipefail
command -v jq >/dev/null || { echo "launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-5400}"
OUT="wave4/logs"
BRIEFS="wave4/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'phase-7-inbox\twave4/briefs/phase-7-inbox.md'
  $'phase-8-ai\twave4/briefs/phase-8-ai.md'
  $'phase-9-writeback-analytics\twave4/briefs/phase-9-crm-writeback-analytics.md'
  $'phase-10-api-webhooks\twave4/briefs/phase-10-api-webhooks-hardening.md'
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
- Fetch current docs via **Context7 MCP** for every non-trivial package (Better Auth apiKey, TanStack Start, Nango, imapflow/mailparser, ai SDK, providers, Drizzle, Recharts). Zero training-data guesses.
- \`pnpm check\` must be **green** before RESULT.json status=ok. Zero errors.
- File-ownership boundaries in \`wave4/WAVE_CONTEXT.md\` are STRICT.
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
echo "wait    : bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh $OUT --summary /tmp/wave4.json"
