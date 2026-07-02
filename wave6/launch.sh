#!/usr/bin/env bash
# wave6/launch.sh — Spawn 2 Cursor Composer 2.5 agents (OMEGA + PSI) with 5s stagger.
set -uo pipefail
command -v jq >/dev/null || { echo "wave6/launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-3600}"
OUT="wave6/logs"
BRIEFS="wave6/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'wave6-omega-cleanup\twave6/briefs/track-omega-cleanup.md'
  $'wave6-psi-docs\twave6/briefs/track-psi-docs.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders (Wave 6)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- **Context7 MCP** for every non-trivial API call. Do NOT rely on training data.
- OMEGA: \`pnpm check\` MUST be **green** before RESULT.json status=ok.
- PSI: docs-only; skim \`pnpm check\` still passes but you're not exercising code.
- **File-ownership boundaries in your brief are STRICT.**
- No migrations in Wave 6. If you need one, STOP and write NEEDS.md.
- Explicit \`.ts\`/\`.tsx\` extensions on relative imports; \`import type\` for type-only.
- Write \`RESULT.json\` at the worktree root when done.

## The stakes

Wave 5 shipped v2.1.0 with the load-bearing engine safe. Wave 6 is the polish that
closes the review report cleanly and gets Quiksend into a state where a new user
can go from git clone to sending a demo sequence in five minutes. Do not skip on
verification. Ship it right the first time."

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
  for _ in $(seq 1 30); do
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
