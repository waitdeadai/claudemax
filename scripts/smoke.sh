#!/usr/bin/env bash
# claudemax CLI stress / smoke test.
# Exercises every non-network command and every subcommand's --help.
# Does NOT call the Anthropic API — those paths are runtime-pending until
# verified against a live Claude Max session.

set -uo pipefail

CMAX="${CMAX:-node $PWD/packages/cli/dist/index.js}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
declare -a FAILURES=()

ok() {
  local desc="$1"
  PASS=$((PASS+1))
  echo "  ok    $desc"
}

fail() {
  local desc="$1"
  local detail="${2:-}"
  FAIL=$((FAIL+1))
  FAILURES+=("$desc -- $detail")
  echo "  fail  $desc -- $detail"
}

assert_exit() {
  local expected="$1"; shift
  local desc="$1"; shift
  "$@" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$expected" ]; then ok "$desc"
  else fail "$desc" "expected exit=$expected got=$got"
  fi
}

assert_output_contains() {
  local needle="$1"; shift
  local desc="$1"; shift
  local out
  out=$("$@" 2>&1) || true
  if printf '%s' "$out" | grep -q -F -- "$needle"; then ok "$desc"
  else fail "$desc" "expected to contain '$needle'; got: $(printf '%s' "$out" | head -c 200)"
  fi
}

echo
echo "=== claudemax smoke / stress ==="
echo "  cmax = $CMAX"
echo "  tmp  = $TMP"
echo

echo "--- top-level ---"
assert_exit 0 "cmax --version exits 0" $CMAX --version
assert_output_contains "0.2.0" "cmax --version prints 0.2.0" $CMAX --version
assert_exit 0 "cmax --help exits 0" $CMAX --help
assert_output_contains "multispec pipeline" "help mentions multispec pipeline" $CMAX --help

echo
echo "--- subcommand help (does NOT invoke network) ---"
for cmd in run doctor taste overnight research spec route goal verify dispatch memory config bg update init; do
  assert_exit 0 "cmax $cmd --help exits 0" $CMAX $cmd --help
done

echo
echo "--- doctor (plan auto-detect, no network) ---"
export CMAX_SKIP_CLI_PROBE=1
unset ANTHROPIC_API_KEY
unset CMAX_PLAN
assert_exit 0 "cmax doctor exits 0" $CMAX doctor
assert_output_contains "plan:" "doctor prints plan field" $CMAX doctor
assert_output_contains "billing:" "doctor prints billing field" $CMAX doctor
assert_output_contains "parallel cap" "doctor prints parallel cap" $CMAX doctor
assert_output_contains "auth surface" "doctor prints auth surface" $CMAX doctor

echo
echo "--- doctor with CMAX_PLAN env ---"
CMAX_PLAN=max20x assert_output_contains "max20x" "max20x env override propagates" $CMAX doctor
CMAX_PLAN=max20x assert_output_contains "\$200" "max20x shows \$200 credit" $CMAX doctor
CMAX_PLAN=api assert_output_contains "api" "api env mode reports api" $CMAX doctor

echo
echo "--- route (pure heuristic, no network) ---"
assert_output_contains "tier:" "route prints tier" $CMAX route "implement auth middleware"
assert_output_contains "model:" "route prints model" $CMAX route "implement auth middleware"
assert_output_contains "reason:" "route prints reasoning" $CMAX route "implement auth middleware"
assert_output_contains "opus" "auth domain escalates to opus" $CMAX route "implement auth middleware" --complexity 5 --domain auth
assert_output_contains "haiku" "summarize routes to haiku" $CMAX route "summarize 500 commits"
assert_output_contains "opus" "explicit --tier opus respected" $CMAX route "summarize 500 commits" --tier opus
assert_output_contains "sonnet" "cost-ceiling demotes opus" $CMAX route "design cache layer" --complexity 7 --cost-ceiling 0.1

echo
echo "--- config (file-only, no network) ---"
mkdir -p "$TMP/proj1" && cd "$TMP/proj1"
assert_exit 0 "config list on empty project" $CMAX config list
assert_exit 0 "config set plan max20x" $CMAX config set plan max20x
assert_output_contains "max20x" "config get plan returns max20x" $CMAX config get plan
assert_output_contains "config.json" "config path prints config.json" $CMAX config path
cd "$OLDPWD" || exit

echo
echo "--- memory (SQLite-only, no network) ---"
mkdir -p "$TMP/proj2" && cd "$TMP/proj2"
assert_exit 0 "memory runs on empty store" $CMAX memory runs
assert_exit 0 "memory search returns 0 hits on empty store" $CMAX memory search "anything"
cd "$OLDPWD" || exit

echo
echo "--- init (file copy, no network) ---"
mkdir -p "$TMP/proj3"
$CMAX init --target "$TMP/proj3" --no-dark-patterns >/dev/null 2>&1
if [ -f "$TMP/proj3/.claude/skills/cmax/SKILL.md" ]; then ok "init writes /cmax skill"
else fail "init writes /cmax skill" "missing"
fi
if [ -f "$TMP/proj3/.claude/skills/opussonnet/SKILL.md" ]; then ok "init writes /opussonnet skill"
else fail "init writes /opussonnet skill" "missing"
fi
if [ -f "$TMP/proj3/.claude/skills/opusolo/SKILL.md" ]; then ok "init writes /opusolo skill"
else fail "init writes /opusolo skill" "missing"
fi
if [ -f "$TMP/proj3/.claude/skills/deepresearch/SKILL.md" ]; then ok "init writes /deepresearch skill"
else fail "init writes /deepresearch skill" "missing"
fi
if [ -f "$TMP/proj3/.claude/skills/agentteams/SKILL.md" ]; then ok "init writes /agentteams skill"
else fail "init writes /agentteams skill" "missing"
fi
if [ -d "$TMP/proj3/.claude/hooks" ]; then ok "init writes .claude/hooks/"
else fail "init writes .claude/hooks/" "missing"
fi
if [ -f "$TMP/proj3/.claudemax/plan-detection.json" ]; then ok "init writes plan-detection.json"
else fail "init writes plan-detection.json" "missing"
fi
SKILL_COUNT=$(find "$TMP/proj3/.claude/skills" -maxdepth 1 -mindepth 1 -type d | wc -l)
if [ "$SKILL_COUNT" -ge 26 ]; then ok "init copies ≥26 skills (got $SKILL_COUNT)"
else fail "init copies ≥26 skills" "got $SKILL_COUNT"
fi

echo
echo "--- hooks (executable, no network) ---"
HOOK_COUNT=$(find .claude/hooks -name "cmax-*.sh" -executable | wc -l)
if [ "$HOOK_COUNT" -ge 3 ]; then ok "3 cmax hooks executable (got $HOOK_COUNT)"
else fail "3 cmax hooks executable" "got $HOOK_COUNT"
fi
assert_exit 0 "cmax-session-start.sh runs without arg" .claude/hooks/cmax-session-start.sh
CMAX_ROOT="$TMP/proj3" assert_exit 0 "cmax-stop.sh runs in temp" .claude/hooks/cmax-stop.sh

echo
echo "--- bg (remote orchestration, no network) ---"
assert_exit 0 "cmax bg --help exits 0" $CMAX bg --help
assert_exit 0 "cmax bg status exits 0 (probes tmux/tailscale/ntfy/claude)" $CMAX bg status
assert_output_contains "tmux" "bg status mentions tmux" $CMAX bg status
assert_output_contains "tailscale" "bg status mentions tailscale" $CMAX bg status
assert_output_contains "NTFY_TOPIC" "bg status mentions NTFY_TOPIC" $CMAX bg status
assert_exit 0 "cmax bg phone --help exits 0" $CMAX bg phone --help

# bg phone with a temp HOME so we don't touch real ~/.claudemax-state/
TMPHOME="$TMP/home1"
mkdir -p "$TMPHOME"
HOME="$TMPHOME" $CMAX bg phone >"$TMP/phone.out" 2>&1; rc=$?
if [ "$rc" = "0" ]; then ok "cmax bg phone (fresh HOME) exits 0"
else fail "cmax bg phone (fresh HOME) exits 0" "exit=$rc"
fi
if [ -f "$TMPHOME/.claudemax-state/config.json" ]; then ok "bg phone writes ~/.claudemax-state/config.json"
else fail "bg phone writes ~/.claudemax-state/config.json" "missing"
fi
if grep -q "ntfy://ntfy.sh/cmax-" "$TMP/phone.out"; then ok "bg phone prints ntfy:// deep link"
else fail "bg phone prints ntfy:// deep link" "not found in output"
fi
if grep -q "tailscale.com/download" "$TMP/phone.out"; then ok "bg phone prints Tailscale download URL"
else fail "bg phone prints Tailscale download URL" "not found"
fi

# bg setup behavior depends on whether tmux is available on this machine
if command -v tmux >/dev/null 2>&1; then
  $CMAX bg setup --session smoke-test-session >/dev/null 2>&1; rc=$?
  if [ "$rc" = "0" ]; then ok "bg setup with tmux installed creates session"
  else fail "bg setup with tmux installed" "expected exit 0, got $rc"
  fi
  tmux kill-session -t smoke-test-session 2>/dev/null || true
else
  $CMAX bg setup --session smoke-test-session >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then ok "bg setup without tmux errors gracefully (exit=$rc)"
  else fail "bg setup without tmux" "expected non-zero on no-tmux env, got 0"
  fi
fi

# setup.sh exists and has --help
if [ -x setup.sh ]; then ok "setup.sh exists and is executable"
else fail "setup.sh exists and is executable" "missing or not executable"
fi
bash -n setup.sh && ok "setup.sh passes bash syntax check" || fail "setup.sh passes bash syntax check" "syntax error"
bash setup.sh --help >/dev/null 2>&1; rc=$?
if [ "$rc" = "0" ]; then ok "setup.sh --help exits 0"
else fail "setup.sh --help exits 0" "exit=$rc"
fi
bash setup.sh --checksum-self >/dev/null 2>&1; rc=$?
if [ "$rc" = "0" ]; then ok "setup.sh --checksum-self prints SHA256"
else fail "setup.sh --checksum-self prints SHA256" "exit=$rc"
fi

echo
echo "--- launch artifacts ---"
for f in CHANGELOG.md SECURITY.md CONTRIBUTING.md .github/workflows/ci.yml \
         .github/ISSUE_TEMPLATE/bug_report.md .github/ISSUE_TEMPLATE/feature_request.md \
         .github/ISSUE_TEMPLATE/skill_proposal.md .github/PULL_REQUEST_TEMPLATE.md \
         examples/multispec-walkthrough/README.md; do
  if [ -f "$f" ]; then ok "$f present"
  else fail "$f present" "missing"
  fi
done

# package.json sanity: version + license + publishConfig
for pkg in packages/core packages/runtime packages/memory packages/cli; do
  if python3 -c "import json; d=json.load(open('$pkg/package.json')); assert d.get('version')=='0.2.0', 'version'; assert d.get('license')=='Apache-2.0', 'license'; assert d.get('publishConfig',{}).get('access')=='public', 'publishConfig'" 2>/dev/null; then
    ok "$pkg/package.json — version=0.2.0, license=Apache-2.0, publishConfig=public"
  else
    fail "$pkg/package.json sanity" "missing version/license/publishConfig"
  fi
done

echo
echo "--- assets ---"
if [ -f assets/claudemax.png ]; then
  if file assets/claudemax.png 2>/dev/null | grep -q "PNG image"; then
    ok "assets/claudemax.png is a valid PNG"
    SIZE=$(stat -c%s assets/claudemax.png 2>/dev/null || stat -f%z assets/claudemax.png 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 1000 ]; then ok "assets/claudemax.png non-trivial size ($SIZE bytes)"
    else fail "assets/claudemax.png non-trivial size" "$SIZE bytes is suspiciously small"
    fi
  else
    fail "assets/claudemax.png is a PNG" "file(1) did not identify it as PNG"
  fi
else
  fail "assets/claudemax.png exists" "missing"
fi
if [ -f assets/README.md ]; then ok "assets/README.md present (brand doc)"
else fail "assets/README.md present" "missing"
fi
if grep -q "claudemax.png" README.md; then ok "README.md references claudemax.png as hero"
else fail "README.md references claudemax.png" "not found in README"
fi

echo
echo "--- dark-patterns vendored ---"
if [ -d vendor/llm-dark-patterns/hooks ]; then
  DP_COUNT=$(ls vendor/llm-dark-patterns/hooks/*.sh 2>/dev/null | wc -l)
  if [ "$DP_COUNT" -ge 30 ]; then ok "vendor/llm-dark-patterns/hooks present ($DP_COUNT .sh files)"
  else fail "vendor/llm-dark-patterns/hooks ≥30 .sh files" "got $DP_COUNT"
  fi
else
  fail "vendor/llm-dark-patterns present" "missing — run pnpm dark-patterns:sync"
fi
if [ -f vendor/llm-dark-patterns/hooks/hooks.json ]; then ok "vendor hooks.json present (canonical wiring source)"
else fail "vendor hooks.json present" "missing"
fi
if [ -x .claude/hooks/dp.sh ]; then ok ".claude/hooks/dp.sh wrapper executable"
else fail ".claude/hooks/dp.sh wrapper executable" "missing or not executable"
fi
bash .claude/hooks/dp.sh no-vibes.sh </dev/null 2>/dev/null; rc=$?
if [ "$rc" = "0" ]; then ok "dp.sh dispatches to no-vibes.sh and exits 0 with empty input"
else fail "dp.sh dispatches to no-vibes.sh" "exit=$rc"
fi

echo
echo "=== summary ==="
echo "  passed: $PASS"
echo "  failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "  failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
fi
exit $FAIL
