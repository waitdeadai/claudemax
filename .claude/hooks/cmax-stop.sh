#!/usr/bin/env bash
# claudemax Stop hook
# - Snapshot run state to .claudemax/state/<ts>.json
# - Push notification via ntfy.sh if NTFY_TOPIC is set (walking-with-headphones use case)

set -euo pipefail

CMAX_ROOT="${CMAX_ROOT:-$PWD}"
STATE_DIR="$CMAX_ROOT/.claudemax/state"
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Read NTFY_TOPIC from global config if env var is not set.
GLOBAL_CONFIG="$HOME/.claudemax-state/config.json"
if [ -z "${NTFY_TOPIC:-}" ] && [ -f "$GLOBAL_CONFIG" ] && command -v python3 >/dev/null 2>&1; then
  NTFY_TOPIC=$(python3 -c "import json, sys; print(json.load(open('$GLOBAL_CONFIG')).get('ntfyTopic', ''))" 2>/dev/null || true)
  export NTFY_TOPIC
fi
if [ -z "${NTFY_SERVER:-}" ] && [ -f "$GLOBAL_CONFIG" ] && command -v python3 >/dev/null 2>&1; then
  NTFY_SERVER=$(python3 -c "import json, sys; print(json.load(open('$GLOBAL_CONFIG')).get('ntfyServer', 'https://ntfy.sh'))" 2>/dev/null || true)
  export NTFY_SERVER
fi

mkdir -p "$STATE_DIR"

SNAPSHOT="$STATE_DIR/stop-$TS.json"

git_status=""
if command -v git >/dev/null 2>&1 && [ -d "$CMAX_ROOT/.git" ]; then
  git_status=$(git -C "$CMAX_ROOT" status --short 2>/dev/null | head -30 || true)
fi

cat > "$SNAPSHOT" <<EOF
{
  "ts": "$TS",
  "cwd": "$CMAX_ROOT",
  "git_status": $(printf '%s' "$git_status" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
}
EOF

# Push notification to phone via ntfy.sh — only fires if NTFY_TOPIC is exported.
# Setup: export NTFY_TOPIC=cmax-<your-handle>, subscribe to the same topic in the
# ntfy iOS/Android app. See docs/REMOTE_OPERATION.md.
if [ -n "${NTFY_TOPIC:-}" ] && command -v curl >/dev/null 2>&1; then
  project=$(basename "$CMAX_ROOT")
  title="${NTFY_TITLE:-claudemax}"
  priority="${NTFY_PRIORITY:-default}"
  body="${project}: run finished at ${TS}"
  if [ -n "$git_status" ]; then
    diff_lines=$(printf '%s' "$git_status" | wc -l | tr -d ' ')
    body="${body} (${diff_lines} files changed)"
  fi
  curl -fsS \
    -H "Title: ${title}" \
    -H "Priority: ${priority}" \
    -H "Tags: rocket,${project}" \
    -d "$body" \
    "${NTFY_SERVER:-https://ntfy.sh}/${NTFY_TOPIC}" >/dev/null 2>&1 || true
fi

exit 0
