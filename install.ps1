# claudemax — local installer (Windows / PowerShell 5.1+).
# No tmux, no Tailscale, no ntfy. Just: clone, build, link, doctor.
#
#   irm https://raw.githubusercontent.com/waitdeadai/claudemax/main/install.ps1 | iex
#
# Power-user defaults baked in:
#   permissionMode = bypassPermissions          (Claude Code --dangerously-skip-permissions equivalent)
#   model: Opus 4.7 for plan/judge/verify, Sonnet 4.6 for sub-Spec exec
#   effort: xhigh                                (Anthropic's recommended max-effort tier for Opus 4.7)
#   verify + spec + architect: always Opus, never demoted
#
# Flags (when run as script, not piped):
#   -InstallDir <path>   install location (default: $env:USERPROFILE\.claudemax)
#   -Global              also create a shim in $env:ProgramFiles\claudemax (needs admin) instead of user-local

[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE ".claudemax"),
  [switch]$Global,
  [switch]$NoAlias,
  [switch]$NoUserInit
)

$ErrorActionPreference = "Stop"

function Ok($m)   { Write-Host "  ok    $m" }
function Warn($m) { Write-Host "  --    $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "  fail  $m" -ForegroundColor Red }
function Head($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

Head "preflight"

function Require-Cmd($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Err "$name not found. $hint"
    exit 1
  }
}
Require-Cmd "node" "Install Node 22+ from https://nodejs.org"
Require-Cmd "git"  "Install Git from https://git-scm.com"

if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
  if (Get-Command "corepack" -ErrorAction SilentlyContinue) {
    Warn "pnpm missing; bootstrapping via corepack..."
    corepack enable
    corepack prepare pnpm@latest --activate
  } else {
    Err "pnpm + corepack both missing. Install pnpm: npm install -g pnpm  (or install corepack)"
    exit 1
  }
}

$nodeVer = (node -v) -replace '^v',''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 22) {
  Err "node $nodeMajor < 22. claudemax requires Node 22+."
  exit 1
}
Ok "node v$nodeVer, pnpm $(pnpm -v), git"

if (Get-Command "claude" -ErrorAction SilentlyContinue) {
  Ok "claude CLI present"
} else {
  Warn "claude CLI not on PATH. Required for the Agent SDK credit billing path AND Mode B (Agent Teams). Install: https://code.claude.com/docs/en/quickstart"
}

Head "clone or update → $InstallDir"
if (Test-Path (Join-Path $InstallDir ".git")) {
  Push-Location $InstallDir
  git pull --ff-only
  Pop-Location
  Ok "updated $InstallDir"
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue)) {
  Err "$InstallDir exists and isn't a git repo. Move it or pass -InstallDir."
  exit 1
} else {
  git clone --depth 1 https://github.com/waitdeadai/claudemax $InstallDir
  Ok "cloned"
}

Head "build"
Push-Location $InstallDir
pnpm install
pnpm build
Pop-Location
Ok "built"

Head "bundle llm-dark-patterns"
$vendorDir = Join-Path $InstallDir "vendor\llm-dark-patterns"
if (Test-Path (Join-Path $vendorDir ".git")) {
  Push-Location $vendorDir
  git pull --ff-only --quiet 2>$null
  Pop-Location
  Ok "updated vendor/llm-dark-patterns"
} else {
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "vendor") | Out-Null
  try {
    git clone --depth 1 https://github.com/waitdeadai/llm-dark-patterns.git $vendorDir 2>$null
    Ok "cloned vendor/llm-dark-patterns"
  } catch {
    Warn "vendor clone failed (offline?); cmax init will skip dark-patterns wiring."
  }
}

Head "shim cmax"
$binSrc = Join-Path $InstallDir "packages\cli\dist\index.js"
if (-not (Test-Path $binSrc)) {
  Err "build did not produce $binSrc"
  exit 1
}

$shimDir = if ($Global.IsPresent) { Join-Path $env:ProgramFiles "claudemax" } else { Join-Path $env:USERPROFILE ".claudemax-bin" }
New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

@"
@echo off
node "$binSrc" %*
"@ | Set-Content -Encoding ASCII (Join-Path $shimDir "cmax.cmd")

@"
@echo off
node "$binSrc" %*
"@ | Set-Content -Encoding ASCII (Join-Path $shimDir "claudemax.cmd")

# Also write a PowerShell function wrapper for users who launch from pwsh
@"
function cmax { node "$binSrc" @args }
function claudemax { node "$binSrc" @args }
"@ | Set-Content -Encoding UTF8 (Join-Path $shimDir "cmax.ps1")

Ok "wrote shims to $shimDir"

# Add to user PATH if not already present
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if (-not ($userPath -split ';' -contains $shimDir)) {
  [Environment]::SetEnvironmentVariable("PATH", "$userPath;$shimDir", "User")
  Warn "$shimDir added to USER PATH — open a NEW shell to pick it up"
} else {
  Ok "$shimDir already in user PATH"
}

Head "minimal config → $env:USERPROFILE\.claudemax-state\config.json"
$configDir = Join-Path $env:USERPROFILE ".claudemax-state"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$configPath = Join-Path $configDir "config.json"
@"
{
  "installedAt": "$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "installDir": "$($InstallDir -replace '\\','\\\\')",
  "mode": "local"
}
"@ | Set-Content -Encoding UTF8 $configPath
Ok "wrote $configPath (mode=local — no remote, no ntfy)"

Head "user-level skill install (run 'claude' from anywhere → /cmax, /ask, /tdd, etc.)"
$userSkillsCmax = Join-Path $env:USERPROFILE ".claude\skills\cmax"
if ($NoUserInit.IsPresent) {
  Warn "skipped (-NoUserInit). Run later with: cmax init --target ~ --force"
} elseif (Test-Path $userSkillsCmax) {
  Ok "user-level skills already present at $userSkillsCmax"
  Warn "refresh anytime with: cmax init --target ~ --force"
} else {
  try {
    node $binSrc init --target $env:USERPROFILE
    if (Test-Path $userSkillsCmax) {
      Ok "wrote $env:USERPROFILE\.claude\skills\ (slash commands now available in EVERY claude session)"
    }
  } catch {
    Warn "user-level init failed; you can retry: cmax init --target ~ --force"
  }
}

Head "cmax doctor"
try { node $binSrc doctor } catch { Warn "cmax doctor failed; new shell may be needed" }

@"

==> Done. Open a NEW PowerShell and try:

  cmax ask "<tu goal en una linea>"

Power-user defaults baked in:
  - permissionMode      bypassPermissions      (--dangerously-skip-permissions equivalent)
  - effort              xhigh                  (Opus 4.7 max-effort tier)
  - plan/judge/verify   Opus 4.7               (never demoted)
  - sub-Spec exec       Sonnet 4.6             (router can escalate to Opus per task)

Skills installed:    $InstallDir\skills\   (29 active skills, lean catalog)
Docs:                $InstallDir\docs\QUICKSTART.md
"@ | Write-Host

# --- shell alias guidance for bare 'claude' REPL ------------------------------
# Per code.claude.com/docs/en/permission-modes (and plugin.json _schemaNote),
# the bare `claude` REPL gates bypassPermissions behind a launch flag —
# settings.json alone is not enough. We PRINT the recommended PowerShell
# function and the exact append command for $PROFILE, but we do NOT auto-modify
# $PROFILE (the user copy-pastes if they want it). Skip the print with -NoAlias.
Head "shell alias guidance for bare 'claude' REPL (--dangerously-skip-permissions)"
if ($NoAlias.IsPresent) {
  Warn "skipped (-NoAlias). For reference: function claude { & claude.cmd --dangerously-skip-permissions @args }"
} else {
  $aliasFn = "function claude { & claude.cmd --dangerously-skip-permissions @args }"
  $appendCmd = "Add-Content -Path `$PROFILE -Value '$aliasFn'"
  $reloadCmd = ". `$PROFILE"
  Write-Host @"
  Recommended PowerShell function (per code.claude.com/docs/en/permission-modes):

    $aliasFn

  To add it to `$PROFILE ($PROFILE), run:

    $appendCmd

  Then open a new PowerShell (or '$reloadCmd') so 'claude' starts in bypass.

  Why this is needed: bypassPermissions in settings.json is necessary-but-not-
  sufficient — Anthropic gates bypass mode behind a launch flag, so the bare
  'claude' REPL also needs --dangerously-skip-permissions on the CLI. We print
  this guidance rather than auto-modifying `$PROFILE. See plugin.json
  _schemaNote for the full citation.
"@
}
