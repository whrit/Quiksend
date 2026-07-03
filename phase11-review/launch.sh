#!/usr/bin/env bash
# phase11-review/launch.sh — Spawn 6 read-only reviewer agents in parallel with 5s stagger.
set -uo pipefail
command -v jq >/dev/null || { echo "phase11-review/launch.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-3600}"
OUT="phase11-review/logs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }

# Ensure local main is up-to-date so worktrees see all Phase 11 code
git fetch origin main >/dev/null 2>&1
git checkout main >/dev/null 2>&1 || true
git pull --ff-only >/dev/null 2>&1 || true

mkdir -p "$OUT" phase11-review/findings
: > "$OUT/manifest.tsv"

DIMS=("security" "correctness" "architecture" "performance" "testing" "completeness")

names=()
for dim in "${DIMS[@]}"; do
  name="phase11-review-$dim"
  brief_file="phase11-review/briefs/$dim.md"
  names+=("$name")

  [[ -f "$brief_file" ]] || { echo "[skip] $name — brief missing" >&2; continue; }

  prompt="You are the **$dim reviewer** for the Phase 11 review of Quiksend.

Read \`phase11-review/CONTEXT.md\` first for shared review context (scope, dimensions, format).
Then read your assigned brief (below).

Your one deliverable is: \`phase11-review/findings/$dim.md\`

Format for that file is specified in the shared context. Follow it exactly.

Rules:
- **Read-only.** No PRs, no code edits. Observe and report.
- Cite \`file:line\` for every finding.
- Confidence field is mandatory: high | medium | low.
- Read the source before flagging. Zero-tolerance for false-positive P1 findings.
- Fast-follows aren't bugs. If the spec explicitly deferred, don't flag as missing.
- Distinguish real defects from stylistic preferences.
- Positive observations at the end. Recognize what's done well.

Do NOT write to any file other than \`phase11-review/findings/$dim.md\`.

## Your brief

$(cat "$brief_file")

## Reference material

- Phase 11 spec: \`docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md\`
- Wave 5 review baseline: \`review/CONSOLIDATED.md\` and \`review/findings/*.md\`
- CLAUDE.md conventions
- User-facing guide: \`docs/deliverability.md\`

## Complete when

- Findings file exists at \`phase11-review/findings/$dim.md\`
- Every finding has severity + confidence + file:line + fix
- Summary at top with counts
- Positive observations at bottom
- No PRs opened, no code changed"

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
