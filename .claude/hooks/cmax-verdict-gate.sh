#!/usr/bin/env bash
# claudemax completion gate (Frente C.1) — the kernel that refuses to mark a
# process "done" without proof. Wired on Stop + SubagentStop.
#
# Reads the active-run sentinel + the verdict artifact that verify() persists
# (both under .claudemax/state/), and BLOCKS (exit 2) ONLY when a run is active
# AND its verdict exists AND its default-FAIL gate did not pass. Fail-open in
# every other branch so it never traps interactive chat or in-flight sub-sessions:
#   - CMAX_VERDICT_GATE_OFF=1                  → exit 0 (escape hatch)
#   - no active-run sentinel                   → exit 0 (interactive chat ungated)
#   - verdict for the active run not yet on disk → exit 0 (don't trap the verifier
#                                                  / goal sub-sessions mid-run)
#   - gate.pass == true                        → exit 0 (verified-with-evidence)
# Only a present-AND-failing verdict for the active run blocks.

set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"

[ "${CMAX_VERDICT_GATE_OFF:-}" = "1" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-${CMAX_ROOT:-$PWD}}"
# Prefer the cwd carried in the hook payload (the SDK provides it) when valid.
PAYLOAD_CWD="$(printf '%s' "$INPUT" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("cwd", "") if isinstance(d, dict) else "")
except Exception:
    print("")' 2>/dev/null || true)"
if [ -n "$PAYLOAD_CWD" ] && [ -d "$PAYLOAD_CWD" ]; then ROOT="$PAYLOAD_CWD"; fi

STATE_DIR="$ROOT/.claudemax/state"
ACTIVE="$STATE_DIR/active-run.json"
[ -f "$ACTIVE" ] || exit 0

python3 - "$STATE_DIR" "$ACTIVE" <<'PY'
import sys, json, os

state_dir, active_path = sys.argv[1], sys.argv[2]
try:
    with open(active_path) as f:
        active = json.load(f)
    h = active.get("specHash")
except Exception:
    sys.exit(0)  # unreadable sentinel → fail-open
if not h:
    sys.exit(0)

vpath = os.path.join(state_dir, "verdict-%s.json" % h)
if not os.path.exists(vpath):
    sys.exit(0)  # verdict not produced yet → don't trap in-flight sub-sessions
try:
    with open(vpath) as f:
        v = json.load(f)
except Exception:
    sys.exit(0)

gate = v.get("gate", {}) or {}
if gate.get("pass") is True:
    sys.exit(0)

reasons = gate.get("reasons") or ["verdict gate did not pass"]
title = v.get("title", h)
lines = [
    'BLOCKED by cmax completion gate: the active run "%s" has a verdict on disk that did NOT pass.' % title,
    '"done" is proven, not declared — the following checks must pass first:',
]
for r in reasons[:12]:
    lines.append("  - %s" % r)
lines += [
    "",
    "Repair: fix the failing condition(s), then re-run the blind verifier (cmax verify) so a passing "
    "verdict-%s.json is written. Do not stop until the gate passes." % h,
    "(Escape hatch for non-gated work: export CMAX_VERDICT_GATE_OFF=1)",
]
sys.stderr.write("\n".join(lines) + "\n")
sys.exit(2)
PY
