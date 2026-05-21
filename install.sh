#!/usr/bin/env bash
# claudemax — local installer (Mac / Linux / WSL).
# No tmux, no Tailscale, no qrencode, no NTFY topic. Just: clone, build, link, doctor.
#
#   curl -fsSL https://raw.githubusercontent.com/waitdeadai/claudemax/main/install.sh | bash
#
# Flags:
#   --install-dir DIR   install location (default: ~/.claudemax)
#   --global            symlink to /usr/local/bin (needs sudo) instead of ~/.local/bin
#   --no-prompt         non-interactive
#   --help              print this header and exit
#
# Power-user defaults baked in:
#   permissionMode = bypassPermissions          (Claude Code's --dangerously-skip-permissions equivalent)
#   model: Opus 4.7 for plan/judge/verify, Sonnet 4.6 for sub-Spec exec
#   effort: xhigh                                (Anthropic's recommended max-effort tier for Opus 4.7)
#   verify + spec + architect: always Opus, never demoted

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.claudemax}"
GLOBAL_LINK=false
NO_PROMPT=false
NO_ALIAS=false

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --global) GLOBAL_LINK=true; shift ;;
    --no-prompt) NO_PROMPT=true; shift ;;
    --no-alias) NO_ALIAS=true; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "! unknown flag: $1"; exit 1 ;;
  esac
done

ok()   { printf "  ok    %s\n" "$*"; }
warn() { printf "  --    %s\n" "$*"; }
err()  { printf "  fail  %s\n" "$*" >&2; }
head() { printf "\n==> %s\n" "$*"; }

head "preflight"
command -v git  >/dev/null 2>&1 || { err "git not found."; exit 1; }
if ! command -v node >/dev/null 2>&1; then
  err "node not found. Install Node 22+:"
  echo "  macOS:  brew install node"
  echo "  Ubuntu: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "  Fedora: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs"
  echo "  Arch:   sudo pacman -S --noconfirm nodejs"
  exit 1
fi
NODE_MAJOR=$(node -v | sed -E 's/v([0-9]+)\..*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "node ${NODE_MAJOR} < 22. claudemax requires Node 22+. Upgrade:"
  echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "  nvm:          nvm install 22 && nvm use 22"
  echo "  Volta:        volta install node@22"
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    warn "pnpm missing; bootstrapping via corepack..."
    corepack enable 2>/dev/null || sudo corepack enable
    corepack prepare pnpm@latest --activate
  else
    err "pnpm + corepack both missing. Install pnpm: npm install -g pnpm  (or install corepack)"
    exit 1
  fi
fi
ok "node $(node -v), pnpm $(pnpm -v), git"

# refuse-as-root: symlinks land in /root/.local/bin and config in /root/.claudemax-state, locking out the real user
if [ "$(id -u)" = "0" ] && [ -z "${SUDO_USER:-}" ]; then
  err "Running as root with no SUDO_USER set. Re-run as your normal user (without sudo):"
  echo "  curl -fsSL https://raw.githubusercontent.com/waitdeadai/claudemax/main/install.sh | bash"
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not on PATH. Required for the Agent SDK credit billing path AND Mode B (Agent Teams). Install: https://code.claude.com/docs/en/quickstart"
else
  ok "claude $(claude --version 2>/dev/null | head -1)"
fi

head "clone or update → $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
  ok "updated $INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
  err "$INSTALL_DIR exists and isn't a git repo. Move it or pass --install-dir."; exit 1
else
  git clone --depth 1 https://github.com/waitdeadai/claudemax "$INSTALL_DIR"
  ok "cloned"
fi

head "build"
cd "$INSTALL_DIR"
pnpm install
pnpm build
ok "built"

head "bundle llm-dark-patterns (skip with: rm -rf $INSTALL_DIR/vendor/llm-dark-patterns)"
if [ -d "$INSTALL_DIR/vendor/llm-dark-patterns/.git" ]; then
  git -C "$INSTALL_DIR/vendor/llm-dark-patterns" pull --ff-only --quiet 2>/dev/null || true
  ok "updated vendor/llm-dark-patterns"
else
  mkdir -p "$INSTALL_DIR/vendor"
  if git clone --depth 1 https://github.com/waitdeadai/llm-dark-patterns.git "$INSTALL_DIR/vendor/llm-dark-patterns" 2>/dev/null; then
    ok "cloned vendor/llm-dark-patterns"
  else
    warn "vendor clone failed (offline?); cmax init will skip dark-patterns wiring."
  fi
fi

head "symlink cmax"
BIN_SRC="$INSTALL_DIR/packages/cli/dist/index.js"
[ -f "$BIN_SRC" ] || { err "build did not produce $BIN_SRC"; exit 1; }
chmod +x "$BIN_SRC"

if [ "$GLOBAL_LINK" = true ]; then
  sudo ln -sf "$BIN_SRC" /usr/local/bin/cmax
  sudo ln -sf "$BIN_SRC" /usr/local/bin/claudemax
  ok "linked /usr/local/bin/{cmax,claudemax}"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$BIN_SRC" "$HOME/.local/bin/cmax"
  ln -sf "$BIN_SRC" "$HOME/.local/bin/claudemax"
  ok "linked $HOME/.local/bin/{cmax,claudemax}"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ok "$HOME/.local/bin already in PATH" ;;
    *) warn "$HOME/.local/bin not in PATH — add to your shell rc: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi

head "minimal config → ~/.claudemax-state/config.json"
CONFIG_DIR="$HOME/.claudemax-state"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.json" <<EOF
{
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installDir": "$INSTALL_DIR",
  "mode": "local"
}
EOF
ok "wrote $CONFIG_DIR/config.json (mode=local — no remote, no ntfy)"

head "cmax doctor"
"$BIN_SRC" doctor || true

cat <<EOF

==> Done. Try it:

  cmax ask "<tu goal en una línea>"

Power-user defaults baked in:
  - permissionMode      bypassPermissions      (--dangerously-skip-permissions equivalent)
  - effort              xhigh                  (Opus 4.7 max-effort tier)
  - plan/judge/verify   Opus 4.7               (never demoted)
  - sub-Spec exec       Sonnet 4.6             (router can escalate to Opus per task)

Skills installed:    $INSTALL_DIR/skills/   (28 skills, lean catalog)
Docs:                $INSTALL_DIR/docs/QUICKSTART.md

For the remote-from-phone flow (Tailscale + tmux + ntfy + QR onboarding), run setup.sh instead.
EOF

# --- shell alias for bare claude REPL bypass ----------------------------------
# Per code.claude.com/docs/en/permission-modes, the bare `claude` REPL gates
# bypassPermissions behind a launch flag. settings.json alone is not enough.
# This appends an alias to the user's shell rc so typing `claude` from now on
# starts in bypass mode. Idempotent via the marker line. Skip with --no-alias.
head "shell alias for bare \`claude\` REPL"
if [ "$NO_ALIAS" = true ]; then
  warn "skipped (--no-alias). Add manually: alias claude='claude --dangerously-skip-permissions'"
else
  ALIAS_MARKER="# claudemax: bypass-permissions alias for bare claude REPL"
  ALIAS_LINE="alias claude='claude --dangerously-skip-permissions'"
  SHELL_RC=""
  case "${SHELL:-}" in
    */zsh) SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    *)
      warn "shell \"${SHELL:-unknown}\" is not bash/zsh; add manually: $ALIAS_LINE"
      SHELL_RC=""
      ;;
  esac
  if [ -n "$SHELL_RC" ]; then
    [ -f "$SHELL_RC" ] || touch "$SHELL_RC"
    if grep -qF "$ALIAS_MARKER" "$SHELL_RC" 2>/dev/null; then
      ok "alias already present in $SHELL_RC"
    else
      {
        printf "\n%s\n%s\n" "$ALIAS_MARKER" "$ALIAS_LINE"
      } >> "$SHELL_RC"
      ok "appended bypass alias to $SHELL_RC"
      warn "open a new shell OR run: source $SHELL_RC   (then \`claude\` starts in bypass)"
    fi
  fi
fi
