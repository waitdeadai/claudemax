#!/usr/bin/env bash
# claudemax remote-operation bootstrap.
# Checks prerequisites for the Tailscale + tmux + ntfy stack and prints the
# exact commands you still need to run yourself.
#
#   bash scripts/setup-remote.sh

set -uo pipefail

ok()   { echo "  ok    $*"; }
warn() { echo "  --    $*"; }
need() { echo "  todo  $*"; }

echo
echo "=== claudemax remote-operation prerequisites ==="
echo

# tmux
if command -v tmux >/dev/null 2>&1; then
  ok "tmux installed ($(tmux -V))"
else
  need "tmux not installed — run: sudo apt install -y tmux   (or brew install tmux)"
fi

# tailscale
if command -v tailscale >/dev/null 2>&1; then
  ok "tailscale binary installed"
  if tailscale status >/dev/null 2>&1; then
    host=$(tailscale status --json 2>/dev/null | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("Self", {}).get("DNSName", "").rstrip("."))' 2>/dev/null || true)
    if [ -n "$host" ]; then
      ok "tailscale up — hostname: $host"
    else
      warn "tailscale installed but couldn't read hostname (try: sudo tailscale up)"
    fi
  else
    need "tailscale not authenticated — run: sudo tailscale up"
  fi
else
  need "tailscale not installed — run: curl -fsSL https://tailscale.com/install.sh | sh"
  need "then on phone: install Tailscale from App Store / Play Store and sign in with the same account"
fi

# curl (for ntfy)
if command -v curl >/dev/null 2>&1; then
  ok "curl installed (ntfy push will work)"
else
  need "curl not installed — run: sudo apt install -y curl"
fi

# NTFY_TOPIC env
if [ -n "${NTFY_TOPIC:-}" ]; then
  ok "NTFY_TOPIC exported (=$NTFY_TOPIC)"
else
  need "NTFY_TOPIC not exported — add to ~/.bashrc or ~/.zshrc:"
  need "    export NTFY_TOPIC=cmax-${USER:-user}-$(date +%Y)"
  need "  then in the ntfy iOS/Android app, subscribe to the same topic"
fi

# claude CLI (for Mode B agent-teams)
if command -v claude >/dev/null 2>&1; then
  ok "claude CLI on PATH ($(claude --version 2>/dev/null | head -1))"
else
  warn "claude CLI not on PATH — needed for Mode B (Agent Teams) subprocess spawn"
  need "  install Claude Code per https://code.claude.com/docs/en/quickstart"
fi

# cmax binary
if command -v cmax >/dev/null 2>&1; then
  ok "cmax on PATH ($(cmax --version 2>/dev/null))"
elif [ -x "packages/cli/dist/index.js" ]; then
  ok "cmax available at ./packages/cli/dist/index.js (consider symlinking)"
  need "  ln -sf \"$PWD/packages/cli/dist/index.js\" \"\$HOME/.local/bin/cmax\""
else
  need "cmax not built — run: pnpm install && pnpm build"
fi

echo
echo "=== next: create a multi-project tmux session ==="
echo
echo "  cmax bg setup --projects ~/work/proj-a,~/work/proj-b,~/work/proj-c"
echo "  cmax bg status      # show remote prereqs anytime"
echo "  cmax bg kill        # kill the claudemax tmux session"
echo
echo "=== next: attach from phone ==="
echo
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  host=$(tailscale status --json 2>/dev/null | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("Self", {}).get("DNSName", "").rstrip("."))' 2>/dev/null || true)
  if [ -n "$host" ]; then
    echo "  on phone (Termius / Termux):"
    echo "    ssh ${USER:-user}@${host} -t \"tmux a -t claudemax\""
  fi
fi
echo
echo "  see docs/REMOTE_OPERATION.md for the full evidence-based setup."
echo
