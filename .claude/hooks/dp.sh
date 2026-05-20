#!/usr/bin/env bash
# claudemax — dark-patterns hook wrapper.
#
# Lets the .claude/settings.json hook entries reference llm-dark-patterns hooks
# by name regardless of where they live on disk. Discovery order:
#   1. CLAUDEMAX_DP_HOOKS_DIR env (explicit override; pin to a specific install)
#   2. CLAUDE_PLUGIN_ROOT (set by Claude Code when the plugin is installed via marketplace)
#   3. walk up from $PWD looking for vendor/llm-dark-patterns/hooks
#   4. ~/.claudemax/vendor/llm-dark-patterns/hooks (default install location)
#   5. <this script's dir>/dark-patterns/hooks (per-project vendored copy via cmax init)
#
# If none found, exits 0 silently. The dark-patterns hooks are advisory; the
# harness must continue functioning even if they're not installed.
#
# Usage from settings.json:
#   { "type": "command", "command": "bash .claude/hooks/dp.sh no-vibes.sh" }

set -euo pipefail

HOOK_NAME="${1:?missing hook name (e.g., no-vibes.sh)}"
shift

discover_hooks_dir() {
  if [ -n "${CLAUDEMAX_DP_HOOKS_DIR:-}" ] && [ -d "$CLAUDEMAX_DP_HOOKS_DIR" ]; then
    printf '%s' "$CLAUDEMAX_DP_HOOKS_DIR"; return
  fi
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT/hooks" ]; then
    printf '%s' "$CLAUDE_PLUGIN_ROOT/hooks"; return
  fi
  local cur="${PWD:-$(pwd)}"
  while [ "$cur" != "/" ] && [ -n "$cur" ]; do
    if [ -d "$cur/vendor/llm-dark-patterns/hooks" ]; then
      printf '%s' "$cur/vendor/llm-dark-patterns/hooks"; return
    fi
    cur="$(dirname "$cur")"
  done
  if [ -d "$HOME/.claudemax/vendor/llm-dark-patterns/hooks" ]; then
    printf '%s' "$HOME/.claudemax/vendor/llm-dark-patterns/hooks"; return
  fi
  local self_dir
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -d "$self_dir/dark-patterns/hooks" ]; then
    printf '%s' "$self_dir/dark-patterns/hooks"; return
  fi
  printf '%s' ''
}

HOOKS_DIR="$(discover_hooks_dir)"
if [ -z "$HOOKS_DIR" ] || [ ! -f "$HOOKS_DIR/$HOOK_NAME" ]; then
  exit 0
fi

# Set CLAUDE_PLUGIN_ROOT so the hook itself can find lib/ + packs/ siblings.
export CLAUDE_PLUGIN_ROOT="$(dirname "$HOOKS_DIR")"

exec bash "$HOOKS_DIR/$HOOK_NAME" "$@"
