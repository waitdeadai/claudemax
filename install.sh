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
NO_USER_INIT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --global) GLOBAL_LINK=true; shift ;;
    --no-prompt) NO_PROMPT=true; shift ;;
    --no-alias) NO_ALIAS=true; shift ;;
    --no-user-init) NO_USER_INIT=true; shift ;;
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

head "user-level skill install (run \`claude\` from anywhere → /cmax, /ask, /tdd, etc.)"
if [ "$NO_USER_INIT" = true ]; then
  warn "skipped (--no-user-init). Run later with: cmax init --target ~ --force"
elif [ -d "$HOME/.claude/skills/cmax" ]; then
  ok "user-level claudemax skills already present at ~/.claude/skills/cmax"
  warn "refresh anytime with: cmax init --target ~ --force"
else
  # Auto-backup case: ~/.claude/skills/ exists but doesn't contain cmax — likely a prior
  # minmaxing v1 install or unrelated user-level skills. cmax init refuses to overwrite a
  # non-empty skills dir, so move it aside first (non-destructive — data preserved).
  if [ -d "$HOME/.claude/skills" ]; then
    BACKUP_DIR="$HOME/.claude/skills.pre-claudemax-backup-$(date +%Y%m%d-%H%M%S)"
    mv "$HOME/.claude/skills" "$BACKUP_DIR"
    warn "found pre-existing ~/.claude/skills/ (likely minmaxing v1 or unrelated user skills)"
    ok "backed up to $BACKUP_DIR  (restore by mv-ing back; nothing was deleted)"
  fi
  "$BIN_SRC" init --target "$HOME" 2>&1 | sed 's/^/  /' || warn "user-level init returned non-zero; retry: cmax init --target ~ --force"
  if [ -d "$HOME/.claude/skills/cmax" ]; then
    ok "wrote ~/.claude/skills/ (slash commands now available in EVERY claude session)"
  fi
fi

# --- ensure ~/.local/bin is on PATH ------------------------------------------
# Idempotent via the same marker pattern as the bash alias block.
if [ "$GLOBAL_LINK" = false ]; then
  PATH_MARKER="# claudemax: ensure ~/.local/bin on PATH"
  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
  PATH_RC=""
  case "${SHELL:-}" in
    */zsh) PATH_RC="$HOME/.zshrc" ;;
    */bash) PATH_RC="$HOME/.bashrc" ;;
  esac
  if [ -n "$PATH_RC" ]; then
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) : ;;  # already on PATH in this shell
      *)
        if ! grep -qF "$PATH_MARKER" "$PATH_RC" 2>/dev/null; then
          {
            printf "\n%s\n%s\n" "$PATH_MARKER" "$PATH_LINE"
          } >> "$PATH_RC"
          ok "appended PATH export to $PATH_RC (new shells will pick it up)"
        fi
        ;;
    esac
  fi
fi

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

Skills installed:    $INSTALL_DIR/skills/   (29 active skills + 1 deprecated stub, lean catalog)
Docs:                $INSTALL_DIR/docs/QUICKSTART.md

For the remote-from-phone flow (Tailscale + tmux + ntfy + QR onboarding), run setup.sh instead.
EOF

# --- shell alias guidance for bare `claude` REPL ------------------------------
# Per code.claude.com/docs/en/permission-modes (and plugin.json _schemaNote),
# the bare `claude` REPL gates bypassPermissions behind a launch flag —
# settings.json alone is not enough. We PRINT the recommended alias and the
# exact append command for the detected shell, but we do NOT auto-modify the
# rc file (the user copy-pastes if they want it). Skip the print with --no-alias.
head "shell alias guidance for bare \`claude\` REPL (--dangerously-skip-permissions)"
if [ "$NO_ALIAS" = true ]; then
  warn "skipped (--no-alias). For reference: alias claude='claude --dangerously-skip-permissions'"
else
  ALIAS_LINE="alias claude='claude --dangerously-skip-permissions'"
  case "${SHELL:-}" in
    */zsh)
      RC_FILE="$HOME/.zshrc"
      APPEND_CMD="echo \"$ALIAS_LINE\" >> \"$RC_FILE\""
      RELOAD_CMD="source $RC_FILE"
      ;;
    */bash)
      RC_FILE="$HOME/.bashrc"
      APPEND_CMD="echo \"$ALIAS_LINE\" >> \"$RC_FILE\""
      RELOAD_CMD="source $RC_FILE"
      ;;
    */fish)
      RC_FILE="$HOME/.config/fish/config.fish"
      APPEND_CMD="echo \"alias claude 'claude --dangerously-skip-permissions'\" >> \"$RC_FILE\""
      RELOAD_CMD="source $RC_FILE"
      ;;
    *)
      RC_FILE="<your shell's rc file>"
      APPEND_CMD="# SHELL=\"${SHELL:-unknown}\" not recognized; add to your shell rc manually:  $ALIAS_LINE"
      RELOAD_CMD="<re-source your shell rc>"
      ;;
  esac
  cat <<EOF
  Recommended alias (per code.claude.com/docs/en/permission-modes):

    $ALIAS_LINE

  To add it to $RC_FILE, run:

    $APPEND_CMD

  Then open a new shell (or \`$RELOAD_CMD\`) so \`claude\` starts in bypass.

  Why this is needed: bypassPermissions in settings.json is necessary-but-not-sufficient.
  Anthropic gates bypass mode behind a launch flag, so the bare \`claude\` REPL also
  needs --dangerously-skip-permissions on the CLI. We print this guidance rather than
  auto-modifying your rc file. See plugin.json _schemaNote for the full citation.
EOF
fi

# Final one-liner recap — the last thing the user sees after install completes,
# so the alias is in the freshest position on their terminal scrollback.
printf '\n[install complete] one-liner recap: %s\n' \
  "alias claude='claude --dangerously-skip-permissions'  # bare REPL bypass"
