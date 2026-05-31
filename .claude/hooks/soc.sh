#!/usr/bin/env bash
# claudemax — searchoclock hook wrapper (sibling of dp.sh).
# Locates the vendored searchoclock.sh regardless of where it lives on disk, then
# execs it with any passed args (e.g. "preflight") and the hook's stdin intact.
# Discovery order:
#   1. CLAUDEMAX_SOC_DIR env (explicit override)
#   2. CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh (claudemax installed via marketplace, sibling vendored)
#   3. walk up from $PWD looking for vendor/searchoclock/searchoclock.sh
#   4. ~/.claudemax/vendor/searchoclock/searchoclock.sh (default install location)
#   5. <this script's dir>/searchoclock/searchoclock.sh (per-project vendored copy via cmax init)
# If none found, exit 0 silently (advisory hook; harness must keep working without it).
#
# Note vs dp.sh: searchoclock takes a positional `preflight` arg and reads the tool-result
# JSON from stdin, so we exec with "$@" (no shift) and do not consume stdin.

set -euo pipefail

discover_soc() {
  if [ -n "${CLAUDEMAX_SOC_DIR:-}" ] && [ -f "$CLAUDEMAX_SOC_DIR/searchoclock.sh" ]; then
    printf '%s' "$CLAUDEMAX_SOC_DIR/searchoclock.sh"; return
  fi
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh"; return
  fi
  local cur="${PWD:-$(pwd)}"
  while [ "$cur" != "/" ] && [ -n "$cur" ]; do
    if [ -f "$cur/vendor/searchoclock/searchoclock.sh" ]; then
      printf '%s' "$cur/vendor/searchoclock/searchoclock.sh"; return
    fi
    cur="$(dirname "$cur")"
  done
  if [ -f "$HOME/.claudemax/vendor/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$HOME/.claudemax/vendor/searchoclock/searchoclock.sh"; return
  fi
  local self_dir; self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$self_dir/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$self_dir/searchoclock/searchoclock.sh"; return
  fi
  printf '%s' ''
}

SOC="$(discover_soc)"
[ -z "$SOC" ] && exit 0
# Tell the hook where the project root is so it finds .claudemax/memory.sqlite + .searchoclock/.
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD:-$(pwd)}}"
exec bash "$SOC" "$@"
