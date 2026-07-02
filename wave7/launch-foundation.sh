#!/usr/bin/env bash
# wave7/launch-foundation.sh — Ship the shared foundation before Wave 7.1 launches.
set -uo pipefail
command -v jq >/dev/null || { echo "wave7/launch-foundation.sh needs jq" >&2; exit 1; }

AGENT_BIN="${AGENT_BIN:-agent}"
MODEL="${MODEL:-composer-2.5}"
HARD_TIMEOUT="${HARD_TIMEOUT:-3600}"
OUT="wave7/logs"
BASE="${WORKTREE_BASE:-main}"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

"$AGENT_BIN" status >/dev/null 2>&1 || { echo "not logged in" >&2; exit 1; }
mkdir -p "$OUT"

name="wave7-foundation"
brief_file="wave7/briefs/foundation.md"

prompt="$(cat "$brief_file")

---

## Final reminders (Wave 7 Foundation)

- Run \`pnpm install --frozen-lockfile\` FIRST on the fresh worktree.
- **Context7 MCP** for every non-trivial API call.
- \`pnpm check\` MUST be **green** before RESULT.json status=ok.
- Migration slot 0015. If your local main is ahead, use next slot but note in RESULT.
- Explicit \`.ts\`/\`.tsx\` extensions on relative imports; \`import type\` for type-only imports.
- Write \`RESULT.json\` at the worktree root when done.

## The stakes

Foundation is the shared prerequisite for Wave 7.1's three parallel tracks (TAU/UPSILON/PHI).
Ship it fast + right so those tracks can start immediately without racing on the shared enum + column names."

echo "[launch] $name (brief: $brief_file)"
${TIMEOUT_BIN:+$TIMEOUT_BIN $HARD_TIMEOUT} "$AGENT_BIN" -p --force --trust \
  --worktree "$name" --worktree-base "$BASE" \
  --model "$MODEL" --output-format stream-json --stream-partial-output \
  "$prompt" >"$OUT/$name.jsonl" 2>"$OUT/$name.err" &
echo $! > "$OUT/$name.pid"

sleep 3
sid=""
for _ in $(seq 1 30); do
  sid="$(grep -m1 '"type":"system"' "$OUT/$name.jsonl" 2>/dev/null | jq -r '.session_id // empty' 2>/dev/null)"
  [[ -n "$sid" ]] && break
  sleep 0.25
done
echo "$name  session=$sid  pid=$(cat "$OUT/$name.pid")"
