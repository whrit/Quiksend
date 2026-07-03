#!/usr/bin/env bash
# wave8/launch.sh — Spawn 4 Composer 2.5 agents (OMICRON + RHO + SIGMA + PHI2) with 5s stagger.
set -uo pipefail
command -v jq >/dev/null || { echo "wave8/launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-7200}"
OUT="wave8/logs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }

# Sync local main so worktrees see latest before creation (Wave 7 lesson)
git fetch origin main >/dev/null 2>&1
git checkout main >/dev/null 2>&1 || true
git pull --ff-only >/dev/null 2>&1 || true

mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

TASKS=(
  $'wave8-omicron-canary\twave8/briefs/track-omicron-canary.md'
  $'wave8-rho-perf\twave8/briefs/track-rho-performance.md'
  $'wave8-sigma-webhook-ui\twave8/briefs/track-sigma-webhook-ui.md'
  $'wave8-phi2-ops-tests\twave8/briefs/track-phi2-ops-tests.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="$(cat "$brief_file")

---

## Final reminders (Wave 8)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- **Context7 MCP** for every non-trivial API call. Do NOT rely on training data.
- \`pnpm check\` MUST be **green** before RESULT.json status=ok.
- **File-ownership boundaries in your brief are STRICT.** If a fix truly requires touching a file owned by another track, write \`NEEDS.md\` at the worktree root and mark RESULT status=partial.
- Migration numbering: OMICRON 0019 (if any), RHO 0020, PHI2 0021 (if any). Rebase-renumber at merge time.
- Explicit \`.ts\`/\`.tsx\` extensions on relative imports; \`import type\` for type-only imports.
- Write \`RESULT.json\` at the worktree root when done.

## The stakes

Phase 11 review found 43 consolidated issues. Wave 8 closes them ALL — signal reliability, fanout wire, provider ops readiness, coverage gaps, arch cleanup. Ship it right the first time — this becomes the credibility bar for Deliverability Pro."

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
  printf '%s\t%s\t%s\n' "$name" "${br:-$name}" "${sid:-?}" >> "$OUT/manifest.tsv"
done

echo
column -t -s $'\t' "$OUT/manifest.tsv" 2>/dev/null || cat "$OUT/manifest.tsv"
