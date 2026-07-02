#!/usr/bin/env bash
# ============================================================================
# wave1/launch.sh — Spawn three Composer 2.5 agents in isolated worktrees for
# Phase 2 (prospects), Phase 3 back-half (Nango + CRM sync), and Phase 4
# back-half (mailboxes + single send). Each agent gets its brief prepended
# with a Context7 + "zero errors" mandate, then works to green in isolation.
#
# Logs land in wave1/logs/{name}.{jsonl,pid,err} + manifest.tsv.
#
# Poll from another shell:  watch -n2 'bash ~/.claude/skills/orchestrating-cursor-agents/status.sh ./wave1/logs'
# Wait from Claude (bg):    bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh ./wave1/logs --summary /tmp/wave1.json
# ============================================================================
set -uo pipefail
command -v jq >/dev/null || { echo "launch.sh needs jq (brew install jq)" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-5400}"     # 90 min per agent — Wave 1 is heavy
OUT="wave1/logs"
BRIEFS="wave1/briefs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in: $AGENT_BIN login" >&2; exit 1; }
mkdir -p "$OUT"
: > "$OUT/manifest.tsv"

# TASKS: name<TAB>brief_file
TASKS=(
  $'phase-2-prospects\twave1/briefs/phase-2-prospects.md'
  $'phase-3-crm\twave1/briefs/phase-3-crm.md'
  $'phase-4-mail\twave1/briefs/phase-4-mail.md'
)

names=()
for entry in "${TASKS[@]}"; do
  name="${entry%%$'\t'*}"
  brief_file="${entry#*$'\t'}"
  names+=("$name")

  if [[ ! -f "$brief_file" ]]; then
    echo "[skip] $name — brief missing: $brief_file" >&2
    continue
  fi

  # Compose the final prompt: brief + explicit final reminders.
  prompt="$(cat "$brief_file")

---

## Final reminders (do not ignore)

- **Fresh worktree**: run \`pnpm install --frozen-lockfile\` FIRST. Nothing else works until deps land.
- **Docs via Context7 MCP**: use the Context7 MCP server to fetch current documentation for every non-trivial package call (Drizzle, TanStack Start, Nango, nodemailer, papaparse, Zod v4, TanStack Table, dnd-kit, pg-boss). Do NOT rely on your training data for API shapes — verify.
- **Zero-tolerance verification**: \`pnpm check\` must be **green** (lint + format + typecheck + all tests). If it fails, iterate — read errors, fix, re-run. You are NOT done until it passes cleanly. Never write \`RESULT.json {\"status\":\"ok\"}\` without this.
- **File-ownership boundaries** from WAVE_CONTEXT.md are STRICT. Touching another track's owned files will cause merge collisions. If you truly need to, mark \`status: \"failed\"\` and explain.
- **Conventional-commit style** is enforced by the CI \`lint-pr\` workflow. Your PR title (which Beckett will craft after merge) starts with \`feat:\` — no worries there. Just keep commits reasonable.
- Write \`RESULT.json\` at the worktree root when done."

  echo "[launch] $name (brief: $brief_file)"
  ${TIMEOUT_BIN:+$TIMEOUT_BIN $HARD_TIMEOUT} "$AGENT_BIN" -p --force --trust \
    --worktree "$name" --worktree-base "$BASE" \
    --model "$MODEL" --output-format stream-json --stream-partial-output \
    "$prompt" >"$OUT/$name.jsonl" 2>"$OUT/$name.err" &
  echo $! > "$OUT/$name.pid"
done

# Harvest session_id from each agent's first system/init line.
sleep 1
for name in "${names[@]}"; do
  sid=""
  for _ in $(seq 1 60); do
    sid="$(grep -m1 '"type":"system"' "$OUT/$name.jsonl" 2>/dev/null \
           | jq -r '.session_id // empty' 2>/dev/null)"
    [[ -n "$sid" ]] && break
    sleep 0.25
  done
  wt="$HOME/.cursor/worktrees/$(basename "$(git rev-parse --show-toplevel)")/$name"
  br="$(git worktree list --porcelain 2>/dev/null \
        | awk -v p="$wt" '/^worktree /{w=$2} /^branch /{b=$2; if(w==p) print b}' \
        | sed 's#refs/heads/##')"
  printf '%s\t%s\t%s\n' "$name" "${br:-$name}" "${sid:-?}" >> "$OUT/manifest.tsv"
done

echo
echo "manifest → $OUT/manifest.tsv"
column -t -s $'\t' "$OUT/manifest.tsv" 2>/dev/null || cat "$OUT/manifest.tsv"
echo
echo "monitor : watch -n2 'bash ~/.claude/skills/orchestrating-cursor-agents/status.sh $OUT'"
echo "wait    : bash ~/.claude/skills/orchestrating-cursor-agents/wait-all.sh $OUT --summary /tmp/wave1.json"
