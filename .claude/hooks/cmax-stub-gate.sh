#!/usr/bin/env bash
# claudemax deterministic stub gate (PRC enforcement, §2-bis "el bar es el bug").
# PreToolUse on Edit|Write|MultiEdit: blocks a write that introduces stub/TODO
# markers into PRODUCTION source. Cheap and infallible; precision-tuned to avoid
# the false positives that would make a user disable it:
#   - skips test/spec/fixture/mock/snapshot files + markdown/docs + json/lockfiles
#   - flags only high-signal markers (TODO/FIXME/XXX/HACK + not-implemented /
#     NotImplementedError / "# stub" / placeholder), NOT the noisy bare words
#     "mock"/"hardcode" (too many legitimate uses to grep deterministically —
#     those are the PRC sub-verifier's job in tranche 3)
#   - a line carrying "cmax-allow" is exempt
# Escape hatch: export CMAX_STUB_GATE_OFF=1.

set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ "${CMAX_STUB_GATE_OFF:-}" = "1" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

TMP="$(mktemp 2>/dev/null || echo "/tmp/cmax-stub-$$.json")"
trap 'rm -f "$TMP"' EXIT
printf '%s' "$INPUT" > "$TMP"

python3 - "$TMP" <<'PY'
import sys, json, re

try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception:
    sys.exit(0)
if not isinstance(d, dict):
    sys.exit(0)

ti = d.get("tool_input") or d.get("toolInput") or {}
if not isinstance(ti, dict):
    sys.exit(0)
path = ti.get("file_path") or ti.get("filePath") or ti.get("path") or ""

# Skip non-production files: tests, fixtures, mocks, snapshots, docs, lockfiles, json.
skip = re.compile(
    r"(\.test\.|\.spec\.|/tests?/|/__tests__/|/__mocks__/|/fixtures?/|/mocks?/|"
    r"\.snap$|\.md$|\.mdx$|\.lock$|pnpm-lock\.yaml$|\.json$)",
    re.I,
)
if path and skip.search(path):
    sys.exit(0)

chunks = []
for key in ("content", "new_string", "newString"):
    if isinstance(ti.get(key), str):
        chunks.append(ti[key])
edits = ti.get("edits")
if isinstance(edits, list):
    for e in edits:
        if isinstance(e, dict) and isinstance(e.get("new_string"), str):
            chunks.append(e["new_string"])
text = "\n".join(chunks)
if not text.strip():
    sys.exit(0)

marker = re.compile(
    r"\b(TODO|FIXME|XXX|HACK|NotImplementedError|unimplemented|placeholder)\b"
    r"|not\s+implemented|#\s*stub\b|/\*\s*stub\b|raise\s+NotImplementedError",
    re.I,
)
hits = []
for i, line in enumerate(text.splitlines(), 1):
    if "cmax-allow" in line:
        continue
    if marker.search(line):
        hits.append((i, line.strip()[:160]))

if not hits:
    sys.exit(0)

out = [
    "BLOCKED by cmax stub gate: this write introduces stub/placeholder markers into production source (%s)."
    % (path or "unknown file"),
    "claudemax default bar is production-ready, not MVP — finish the implementation instead of leaving a marker:",
]
for ln, txt in hits[:10]:
    out.append("  line %d: %s" % (ln, txt))
out.append("")
out.append(
    'Repair: implement the real behavior; or (if intentional) add "cmax-allow" to the line; '
    "or export CMAX_STUB_GATE_OFF=1 for this session."
)
sys.stderr.write("\n".join(out) + "\n")
sys.exit(2)
PY
