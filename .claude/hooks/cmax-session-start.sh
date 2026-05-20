#!/usr/bin/env bash
# claudemax SessionStart hook
# - Injects taste.md + taste.vision into the session context if present
# - Injects recent memory hits for the current goal context

set -euo pipefail

CMAX_ROOT="${CMAX_ROOT:-$PWD}"
TASTE_MD="$CMAX_ROOT/taste.md"
TASTE_VISION="$CMAX_ROOT/taste.vision"
MEMORY_DB="$CMAX_ROOT/.claudemax/memory.sqlite"

emit_context() {
  local kind="$1"
  local body="$2"
  cat <<EOF
[claudemax SessionStart] $kind
$body
EOF
}

if [ -f "$TASTE_MD" ]; then
  emit_context "taste.md" "$(head -c 3500 "$TASTE_MD")"
fi

if [ -f "$TASTE_VISION" ]; then
  emit_context "taste.vision" "$(head -c 1500 "$TASTE_VISION")"
fi

# Surface recent runs if memory db exists
if [ -f "$MEMORY_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  recent=$(sqlite3 "$MEMORY_DB" "SELECT ts || '  ' || status || '  ' || substr(spec_title, 1, 60) FROM runs ORDER BY id DESC LIMIT 3" 2>/dev/null || true)
  if [ -n "$recent" ]; then
    emit_context "recent runs" "$recent"
  fi
fi

exit 0
