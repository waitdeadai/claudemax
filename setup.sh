#!/usr/bin/env bash
# claudemax one-line installer — production-grade for the "main mode while away from the computer" flow.
#
#   curl -fsSL https://raw.githubusercontent.com/waitdeadai/claudemax/main/setup.sh | bash
#
# What it does, in order:
#   1. Preflight: node 22+, pnpm, git, curl, python3.
#   2. Auto-install (with sudo confirm): tmux, qrencode, Tailscale.
#   3. Clone or update claudemax into ~/.claudemax (or --install-dir).
#   4. pnpm install + build.
#   5. Symlink cmax to $HOME/.local/bin (or /usr/local/bin with --global).
#   6. Generate NTFY_TOPIC + write to .claudemax/config.json.
#   7. Print phone-side onboarding: QR codes for the ntfy deep link + Tailscale download + Termius/Termux install.
#   8. Print remote-attach command (Tailscale hostname interpolated).
#   9. Print dark-patterns plugin install command.
#
# Flags:
#   --global                  symlink to /usr/local/bin (needs sudo) instead of ~/.local/bin
#   --skip-dark-patterns      skip the dark-patterns plugin install hint
#   --skip-tailscale          do not auto-install Tailscale (you'll install it yourself)
#   --skip-tmux               do not auto-install tmux
#   --skip-qrencode           do not auto-install qrencode (phone QR codes degrade to URLs)
#   --install-dir DIR         install location (default: ~/.claudemax)
#   --ntfy-topic TOPIC        set NTFY_TOPIC explicitly instead of auto-generating
#   --no-prompt               non-interactive; auto-yes for sudo dep installs
#
# Safety:
#   The Tailscale install uses the official https://tailscale.com/install.sh script.
#   Inspect this file at https://raw.githubusercontent.com/waitdeadai/claudemax/main/setup.sh before running.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.claudemax}"
GLOBAL_LINK=false
SKIP_DARK_PATTERNS=false
SKIP_TAILSCALE=false
SKIP_TMUX=false
SKIP_QRENCODE=false
NO_PROMPT=false
NTFY_TOPIC_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --global) GLOBAL_LINK=true; shift ;;
    --skip-dark-patterns) SKIP_DARK_PATTERNS=true; shift ;;
    --skip-tailscale) SKIP_TAILSCALE=true; shift ;;
    --skip-tmux) SKIP_TMUX=true; shift ;;
    --skip-qrencode) SKIP_QRENCODE=true; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --ntfy-topic) NTFY_TOPIC_OVERRIDE="$2"; shift 2 ;;
    --no-prompt) NO_PROMPT=true; shift ;;
    --checksum-self)
      # Print this script's SHA256 so users can compare against the published checksum.
      if command -v sha256sum >/dev/null 2>&1; then sha256sum "$0"; exit 0
      elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$0"; exit 0
      else echo "! no sha256sum/shasum available"; exit 1; fi ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "! unknown flag: $1"; exit 1 ;;
  esac
done

# ---- helpers ---------------------------------------------------------------

ok()   { printf "  ok    %s\n" "$*"; }
warn() { printf "  --    %s\n" "$*"; }
err()  { printf "  fail  %s\n" "$*" >&2; }
head() { printf "\n==> %s\n" "$*"; }

confirm() {
  # confirm "Install X?" — defaults to yes; --no-prompt = yes
  if [ "$NO_PROMPT" = true ]; then return 0; fi
  read -r -p "$1 [Y/n] " ans </dev/tty || return 1
  case "${ans:-y}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

OS=$(uname -s)
ARCH=$(uname -m)
DISTRO=""
PKG=""
if [ "$OS" = "Linux" ]; then
  if command -v apt-get >/dev/null 2>&1; then PKG=apt; DISTRO=debian
  elif command -v dnf >/dev/null 2>&1; then PKG=dnf; DISTRO=fedora
  elif command -v pacman >/dev/null 2>&1; then PKG=pacman; DISTRO=arch
  fi
elif [ "$OS" = "Darwin" ]; then
  PKG=brew; DISTRO=macos
fi

install_pkg() {
  # install_pkg <human-name> <apt-name> <brew-name> <dnf-name> <pacman-name>
  local human="$1" aptn="$2" brewn="$3" dnfn="$4" pacn="$5"
  if [ "$NO_PROMPT" != true ]; then
    confirm "Install ${human}?" || { warn "skipped ${human}"; return 1; }
  fi
  case "$PKG" in
    apt)    sudo apt-get update -qq && sudo apt-get install -y "$aptn" ;;
    brew)   brew install "$brewn" ;;
    dnf)    sudo dnf install -y "$dnfn" ;;
    pacman) sudo pacman -Sy --noconfirm "$pacn" ;;
    *) err "unsupported package manager; please install ${human} manually."; return 1 ;;
  esac
}

# ---- 1. Preflight ----------------------------------------------------------

head "preflight"
command -v node    >/dev/null 2>&1 || { err "node not found. install Node 22+ first."; exit 1; }
command -v pnpm    >/dev/null 2>&1 || { err "pnpm not found. run: corepack enable && corepack prepare pnpm@latest --activate"; exit 1; }
command -v git     >/dev/null 2>&1 || { err "git not found."; exit 1; }
command -v curl    >/dev/null 2>&1 || { err "curl not found."; exit 1; }
command -v python3 >/dev/null 2>&1 || { warn "python3 not found — hooks that use python3 will skip silently."; }
NODE_MAJOR=$(node -v | sed -E 's/v([0-9]+)\..*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "node ${NODE_MAJOR} < 22. claudemax requires Node 22+."
  exit 1
fi
ok "node $(node -v), pnpm $(pnpm -v), git, curl"
ok "OS=$OS DISTRO=${DISTRO:-unknown} PKG=${PKG:-unknown}"

# ---- 2. Auto-install deps --------------------------------------------------

head "dependencies"
if ! command -v tmux >/dev/null 2>&1; then
  if [ "$SKIP_TMUX" = true ]; then
    warn "tmux missing; --skip-tmux passed. Install yourself for the multi-project background flow."
  else
    install_pkg "tmux" tmux tmux tmux tmux || warn "tmux install skipped; the cmax bg setup flow will not work."
  fi
else
  ok "tmux $(tmux -V | awk '{print $2}')"
fi

if ! command -v qrencode >/dev/null 2>&1; then
  if [ "$SKIP_QRENCODE" = true ]; then
    warn "qrencode missing; --skip-qrencode passed. Phone QR codes will degrade to URLs."
  else
    install_pkg "qrencode (for phone QR codes)" qrencode qrencode qrencode qrencode || warn "qrencode skipped; phone setup will print URLs instead of QR codes."
  fi
else
  ok "qrencode"
fi

if ! command -v tailscale >/dev/null 2>&1; then
  if [ "$SKIP_TAILSCALE" = true ]; then
    warn "tailscale missing; --skip-tailscale passed. Remote-from-phone access disabled."
  else
    if confirm "Install Tailscale via the official script (https://tailscale.com/install.sh)?"; then
      if [ "$OS" = "Darwin" ]; then
        brew install --cask tailscale || warn "tailscale brew install failed."
      else
        curl -fsSL https://tailscale.com/install.sh | sh
      fi
      warn "after install, run: sudo tailscale up (browser-based auth, then sign in with the same account on phone)"
    else
      warn "skipped Tailscale install; remote-from-phone access will not work until you install it manually."
    fi
  fi
else
  ok "tailscale $(tailscale version 2>/dev/null | head -1)"
fi

if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not on PATH. Mode B (Agent Teams) subprocess + the subscription-Agent-SDK-credit billing path require it. See https://code.claude.com/docs/en/quickstart"
else
  ok "claude $(claude --version 2>/dev/null | head -1)"
fi

# ---- 3. Clone or update ----------------------------------------------------

head "clone or update claudemax → $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
  ok "updated $INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
  err "$INSTALL_DIR exists and isn't a git repo. Move it aside or pass --install-dir."
  exit 1
else
  git clone --depth 1 https://github.com/waitdeadai/claudemax "$INSTALL_DIR"
  ok "cloned"
fi

# ---- 4. Build + vendor dark-patterns --------------------------------------

head "build"
cd "$INSTALL_DIR"
pnpm install
pnpm build
ok "built"

head "bundle llm-dark-patterns (waitdeadai)"
if [ "$SKIP_DARK_PATTERNS" = true ]; then
  warn "skipped (--skip-dark-patterns); cmax init will not wire dark-patterns hooks into target projects"
else
  if [ -d "$INSTALL_DIR/vendor/llm-dark-patterns/.git" ]; then
    git -C "$INSTALL_DIR/vendor/llm-dark-patterns" pull --ff-only --quiet 2>/dev/null || true
    ok "updated vendor/llm-dark-patterns"
  else
    mkdir -p "$INSTALL_DIR/vendor"
    if git clone --depth 1 https://github.com/waitdeadai/llm-dark-patterns.git "$INSTALL_DIR/vendor/llm-dark-patterns" 2>/dev/null; then
      ok "cloned vendor/llm-dark-patterns"
    else
      warn "vendor clone failed (offline?); cmax init will skip dark-patterns until you run: pnpm dark-patterns:sync"
    fi
  fi
fi

head "install agentcloseout-physics (deterministic closeout scorer)"
# Activates the Rust scoring path in 19 dark-pattern hooks (honest-eta,
# no-aggregator-hallucination, no-ai-tells, no-fake-cite, no-fake-recall,
# no-prompt-restate, no-curfew, no-tldr-bait, no-cherry-pick-rollup,
# no-sandbagging-disguise, no-fake-stats, no-meta-commentary,
# no-phantom-tool-call, no-credential-leak-in-handoff, no-roleplay-drift,
# no-rollback-claim-without-evidence, no-emoji-spam, no-silent-worker-success,
# no-disclaimer-spam) — replaces the coarse bash regex fallback.
#
# Install path is the SOTA-2026 canonical one-liner — same shape rustup,
# bun, deno, starship, zoxide all use. Generated by cargo-dist on every
# tagged release (.github/workflows/release.yml in agent-closeout-bench).
# Sources accessed 2026-05-21:
#   - axodotdev.github.io/cargo-dist (canonical Rust binary distribution)
#   - rustup.rs (the rustup-init bootstrap loader; --tlsv1.2 enforced)
#   - starship.rs/install.sh (same pattern, same shape)
#
PHYSICS_VERSION="${AGENTCLOSEOUT_PHYSICS_VERSION:-0.2.3}"
PHYSICS_INSTALLER_URL="https://github.com/waitdeadai/agent-closeout-bench/releases/download/v${PHYSICS_VERSION}/agentcloseout-physics-installer.sh"
if command -v agentcloseout-physics >/dev/null 2>&1; then
  ok "agentcloseout-physics already on PATH ($(command -v agentcloseout-physics))"
elif command -v curl >/dev/null 2>&1; then
  if curl --proto '=https' --tlsv1.2 -LsSf "$PHYSICS_INSTALLER_URL" | sh 2>&1; then
    ok "installed agentcloseout-physics v${PHYSICS_VERSION} via canonical install.sh"
  else
    warn "agentcloseout-physics install.sh failed."
    warn "  19 dark-pattern hooks will use bash-regex fallback. Functional but coarser."
    warn "  Manual install: $PHYSICS_INSTALLER_URL"
  fi
else
  warn "no curl available — cannot install agentcloseout-physics."
  warn "  19 dark-pattern hooks will use bash-regex fallback. Functional but coarser."
fi

head "sync dark-patterns hooks to Claude Code plugin cache (if present)"
# Claude Code's plugin marketplace caches a separate copy at
# ~/.claude/plugins/cache/waitdeadai-plugins/llm-dark-patterns/<ver>/hooks/.
# When the marketplace plugin lags behind upstream, those copies override
# our vendor patches. Sync upstream → cache so the latest upstream hooks
# win even before the plugin tarball updates.
if [ "$SKIP_DARK_PATTERNS" != true ] && [ -d "$INSTALL_DIR/vendor/llm-dark-patterns/hooks" ]; then
  for plugin_cache_hooks in \
    "$HOME/.claude/hooks/dark-patterns/hooks" \
    "$HOME/.claude/plugins/cache/waitdeadai-plugins/llm-dark-patterns"/*/hooks; do
    [ -d "$plugin_cache_hooks" ] || continue
    cp -f "$INSTALL_DIR/vendor/llm-dark-patterns/hooks"/*.sh "$plugin_cache_hooks/" 2>/dev/null || true
    ok "synced upstream hooks → $plugin_cache_hooks"
  done
fi

# ---- 5. Symlink ------------------------------------------------------------

head "symlink"
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
    *) warn "$HOME/.local/bin not in PATH — add: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi

# ---- 6. Generate NTFY_TOPIC + write config ---------------------------------

head "ntfy topic + claudemax config"
CONFIG_DIR="$HOME/.claudemax-state"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.json"

NTFY_TOPIC=""
if [ -n "$NTFY_TOPIC_OVERRIDE" ]; then
  NTFY_TOPIC="$NTFY_TOPIC_OVERRIDE"
elif [ -f "$CONFIG_FILE" ] && command -v python3 >/dev/null 2>&1; then
  NTFY_TOPIC=$(python3 -c "import json, sys; print(json.load(open('$CONFIG_FILE')).get('ntfyTopic', ''))" 2>/dev/null || true)
fi
if [ -z "$NTFY_TOPIC" ]; then
  RAND=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 10 2>/dev/null || date +%s)
  NTFY_TOPIC="cmax-${USER:-user}-${RAND}"
fi

cat > "$CONFIG_FILE" <<EOF
{
  "ntfyTopic": "$NTFY_TOPIC",
  "ntfyServer": "https://ntfy.sh",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installDir": "$INSTALL_DIR"
}
EOF
ok "NTFY_TOPIC=$NTFY_TOPIC  (config: $CONFIG_FILE)"

# Add an export hint to the user's shell rc if they want it
SHELL_RC=""
case "${SHELL:-}" in
  */bash) SHELL_RC="$HOME/.bashrc" ;;
  */zsh)  SHELL_RC="$HOME/.zshrc" ;;
esac
if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
  if ! grep -q "NTFY_TOPIC=" "$SHELL_RC" 2>/dev/null; then
    if confirm "Append 'export NTFY_TOPIC=$NTFY_TOPIC' to $SHELL_RC?"; then
      printf '\n# claudemax — phone push notifications via ntfy.sh\nexport NTFY_TOPIC=%s\n' "$NTFY_TOPIC" >> "$SHELL_RC"
      ok "appended to $SHELL_RC (open a new shell or 'source $SHELL_RC' to activate)"
    fi
  else
    ok "$SHELL_RC already exports NTFY_TOPIC"
  fi
fi

# ---- 7. Phone-side onboarding ---------------------------------------------

head "phone-side onboarding"
NTFY_DEEP="ntfy://ntfy.sh/$NTFY_TOPIC"
NTFY_WEB="https://ntfy.sh/$NTFY_TOPIC"

print_qr() {
  local target="$1"; local label="$2"
  if command -v qrencode >/dev/null 2>&1; then
    printf "\n  %s — scan with phone camera:\n\n" "$label"
    qrencode -t UTF8 -m 1 "$target"
    printf "  %s\n" "$target"
  else
    printf "  %s: %s\n" "$label" "$target"
  fi
}

print_qr "$NTFY_DEEP" "1. Install ntfy.sh app (iOS App Store / Play Store / F-Droid) and subscribe to your topic"
printf "\n     (also: open %s in any browser for a web fallback)\n" "$NTFY_WEB"

print_qr "https://tailscale.com/download" "2. Install Tailscale app on phone and sign in with the same account as PC"

print_qr "https://itunes.apple.com/app/id549039908" "3a. iOS: install Termius (SSH client) — or use Blink Shell"
print_qr "https://play.google.com/store/apps/details?id=com.termux" "3b. Android: install Termux (full Linux terminal) — or Termius"

# Tailscale hostname (live)
TS_HOST=""
if command -v tailscale >/dev/null 2>&1; then
  TS_HOST=$(tailscale status --json 2>/dev/null | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("Self", {}).get("DNSName", "").rstrip("."))' 2>/dev/null || true)
fi
if [ -n "$TS_HOST" ]; then
  head "remote-attach command (Tailscale hostname auto-detected)"
  printf "  ssh %s@%s -t \"tmux a -t claudemax\"\n" "${USER:-user}" "$TS_HOST"
  printf "\n  (run this in Termius / Termux from your phone once you've set up the tmux session via: cmax bg setup --projects ...)\n"
else
  warn "Tailscale not yet authenticated. After 'sudo tailscale up', re-run: cmax bg status"
fi

# ---- 8. Dark-patterns status -----------------------------------------------

if [ "$SKIP_DARK_PATTERNS" = false ]; then
  head "dark-patterns hooks"
  if [ -d "$INSTALL_DIR/vendor/llm-dark-patterns/hooks" ]; then
    n=$(ls "$INSTALL_DIR/vendor/llm-dark-patterns/hooks"/*.sh 2>/dev/null | wc -l | tr -d ' ')
    ok "bundled — ${n} hooks at $INSTALL_DIR/vendor/llm-dark-patterns/hooks/"
    ok "every \`cmax init\` will copy them into the target project's .claude/hooks/dark-patterns/"
    ok "wired into Stop / SubagentStop / PreToolUse / PostToolUse / TaskCreated / TaskCompleted / PreCompact / PostCompact / SessionStart / UserPromptSubmit"
    echo "  See $INSTALL_DIR/.claude/DARK_PATTERNS_INSTALL.md for the full inventory."
  else
    warn "vendor/llm-dark-patterns/hooks missing — run: pnpm dark-patterns:sync"
  fi
fi

# ---- 9. Final state --------------------------------------------------------

head "final state — cmax doctor"
"$BIN_SRC" doctor || true

head "final state — cmax bg status"
"$BIN_SRC" bg status || true

cat <<EOF

==> Installer done.

Next, you (the user) need to:
  1. (if not yet) sudo tailscale up   → browser auth, then install Tailscale on phone and sign in.
  2. Open the ntfy app on phone and subscribe to: $NTFY_TOPIC
  3. Configure SSH key auth from phone to PC (Termius UI / Termux ssh-copy-id).
  4. Run:    cmax bg setup --projects ~/path/to/proj-a,~/path/to/proj-b
  5. Attach from phone in Termius/Termux with the ssh command above.
  6. Try:    cmax run "<your first real goal>"

Docs:  $INSTALL_DIR/docs/REMOTE_OPERATION.md  ·  $INSTALL_DIR/docs/QUICKSTART.md
EOF
