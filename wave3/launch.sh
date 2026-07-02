#!/usr/bin/env bash
# ============================================================================
# wave3/launch.sh — Spawn Wave-3 Cursor Composer agents in isolated worktrees:
#   - phase-6-engine        (Track G — SERIAL GATE, engine)
#   - phase-7-prep-inbound  (Track H — pure logic side-quest)
#   - phase-8-prep-ai       (Track I — packages/ai + value_prop CRUD)
#
# Wave 2 (Phase 5 sequences + Phase 4 gmail/graph) must be MERGED first.
# ============================================================================
set -uo pipefail
command -v jq >/dev/null || { echo "launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
# Engine is highest-risk; give it more headroom
HARD_TIMEOUT="${HARD_TIMEOUT:-7200}"
OUT="wave3/logs"
BRIEFS="wave3/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'phase-6-engine\twave3/briefs/phase-6-engine.md'
  $'phase-7-prep-inbound\twave3/briefs/phase-7-prep-inbound.md'
  $'phase-8-prep-ai\twave3/briefs/phase-8-prep-ai-interfaces.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders (Track G especially: this is the correctness cliff)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- Fetch current docs via **Context7 MCP** for every non-trivial package (Drizzle raw SQL, pg-boss v12, ai SDK, @ai-sdk/*, pgvector, mailparser). Do NOT rely on training data.
- \`pnpm check\` must be **green** before RESULT.json status=ok. Zero lint errors, zero type errors, zero failing tests.
- Track G: the load test in scripts/load-test-engine.ts is REQUIRED. No cutting corners. Zero double-sends, zero cap breaches, zero crashes — or the engine is not ready.
- File-ownership boundaries in \`wave3/WAVE_CONTEXT.md\` are STRICT.
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
echo "wait    : bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh $OUT --summary /tmp/wave3.json"
