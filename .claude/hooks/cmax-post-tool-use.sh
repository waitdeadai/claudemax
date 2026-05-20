#!/usr/bin/env bash
# claudemax PostToolUse hook (matcher: Edit|Write)
# - Snapshot file checkpoint diffs into .claudemax/state/checkpoints/ for rollback
# - Append to audit log

set -euo pipefail

CMAX_ROOT="${CMAX_ROOT:-$PWD}"
CHECKPOINT_DIR="$CMAX_ROOT/.claudemax/state/checkpoints"
AUDIT_LOG="$CMAX_ROOT/.claudemax/state/audit.log"

mkdir -p "$CHECKPOINT_DIR"
mkdir -p "$(dirname "$AUDIT_LOG")"

# Hook input is JSON on stdin per Claude Code spec
INPUT=$(cat || true)
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Extract file_path field (best-effort; skip silently if jq missing)
FILE_PATH=""
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
fi

if [ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ]; then
  # Record audit line
  echo "$TS  modify  $FILE_PATH" >> "$AUDIT_LOG"
  # Stash a copy (idempotent per-second)
  REL=${FILE_PATH#"$CMAX_ROOT"/}
  CK_PATH="$CHECKPOINT_DIR/$TS-$(echo "$REL" | tr '/' '_')"
  cp -p "$FILE_PATH" "$CK_PATH" 2>/dev/null || true
fi

exit 0
