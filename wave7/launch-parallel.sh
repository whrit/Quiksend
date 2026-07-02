#!/usr/bin/env bash
# wave7/launch-parallel.sh — Wave 7.1: TAU + UPSILON + PHI + OMEGA-OPS in parallel with 5s stagger.
set -uo pipefail
command -v jq >/dev/null || { echo "wave7/launch-parallel.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-7200}"
OUT="wave7/logs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/parallel-manifest.tsv"

TASKS=(
  $'wave7-tau-detection\twave7/briefs/track-tau-detection.md'
  $'wave7-upsilon-routing\twave7/briefs/track-upsilon-routing.md'
  $'wave7-phi-canary\twave7/briefs/track-phi-canary.md'
  $'wave7-omega-ops-runbook\twave7/briefs/track-omega-ops-runbook.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders (Wave 7.1)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- **Context7 MCP** for every non-trivial API call. Do NOT rely on training data.
- \`pnpm check\` MUST be **green** before RESULT.json status=ok. Zero lint, zero type, zero failing tests.
- **File-ownership boundaries in your brief are STRICT.** If a fix truly requires touching a file owned by another track, write \`NEEDS.md\` at the worktree root and mark RESULT status=partial with a note.
- Migration numbering: TAU 0016, UPSILON 0017, PHI 0018. Rebase-renumber if merge order shifts.
- Explicit \`.ts\`/\`.tsx\` extensions on relative imports; \`import type\` for type-only imports.
- Write \`RESULT.json\` at the worktree root when done.

## The stakes

Phase 11 gives Quiksend the enterprise-deliverability wedge nobody else has: real-time SEG detection + routing + canary drop detection. Ship it right the first time — this becomes the marketing hook and paid-tier revenue anchor. Read the source before touching it. Verify with tests. Coordinate at NEEDS.md when boundaries flex."

  echo "[launch] $name (brief: $brief_file)"
  ${TIMEOUT_BIN:+$TIMEOUT_BIN $HARD_TIMEOUT} "$AGENT_BIN" -p --force --trust \
    --worktree "$name" --worktree-base "$BASE" \
    --model "$MODEL" --output-format stream-json --stream-partial-output \
    "$prompt" >"$OUT/$name.jsonl" 2>"$OUT/$name.err" &
  echo $! > "$OUT/$name.pid"
  # 5s stagger to defeat the cli-config.json race
  sleep 5
done

sleep 3
for name in "${names[@]}"; do
  sid=""
  for _ in $(seq 1 60); do
    sid="$(grep -m1 '"type":"system"' "$OUT/$name.jsonl" 2>/dev/null | jq -r '.session_id // empty' 2>/dev/null)"
    [[ -n "$sid" ]] && break
    sleep 0.25
  done
  wt="$HOME/.cursor/worktrees/$(basename "$(git rev-parse --show-toplevel)")/$name"
  br="$(git worktree list --porcelain 2>/dev/null | awk -v p="$wt" '/^worktree /{w=$2} /^branch /{b=$2; if(w==p) print b}' | sed 's#refs/heads/##')"
  printf '%s\t%s\t%s\n' "$name" "${br:-$name}" "${sid:-?}" >> "$OUT/parallel-manifest.tsv"
done

echo
column -t -s $'\t' "$OUT/parallel-manifest.tsv" 2>/dev/null || cat "$OUT/parallel-manifest.tsv"
