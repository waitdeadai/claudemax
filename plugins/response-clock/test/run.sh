#!/usr/bin/env bash
# response-clock — smoke test. Simulates the real stdin payloads Claude Code sends
# to UserPromptSubmit and Stop hooks, then asserts the emitted JSON.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
HOOKS="$(cd "$HERE/../hooks" && pwd)"
START="$HOOKS/stamp-start.sh"
END="$HOOKS/stamp-end.sh"
THINK="$HOOKS/stamp-thinking.sh"
FIRSTTOOL="$HOOKS/stamp-firsttool.sh"

DATA="$(mktemp -d)"
trap 'rm -rf "$DATA"' EXIT
export CLAUDE_PLUGIN_DATA="$DATA"

SID="test-$$-session"
PAYLOAD="$(printf '{"session_id":"%s","hook_event_name":"UserPromptSubmit","cwd":"/tmp","prompt":"hi"}' "$SID")"
END_PAYLOAD="$(printf '{"session_id":"%s","hook_event_name":"Stop","cwd":"/tmp"}' "$SID")"

pass=0; fail=0
ok()   { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

is_json() {
  if command -v jq >/dev/null 2>&1; then printf '%s' "$1" | jq -e . >/dev/null 2>&1
  else printf '%s' "$1" | python3 -c 'import sys,json; json.load(sys.stdin)' >/dev/null 2>&1
  fi
}
field() {
  if command -v jq >/dev/null 2>&1; then printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null
  else printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+'$3') if False else d.get('${2#.}',''))" 2>/dev/null
  fi
}

echo "== start hook =="
out="$(printf '%s' "$PAYLOAD" | bash "$START")"
is_json "$out" && ok "start emits valid JSON" || bad "start JSON ($out)"
sysmsg="$(printf '%s' "$out" | jq -r '.systemMessage // empty' 2>/dev/null || true)"
printf '%s' "$sysmsg" | grep -qE '^[0-9]{2}:[0-9]{2}:[0-9]{2}$' && ok "start systemMessage is a HH:MM:SS time ($sysmsg)" || bad "start systemMessage ($sysmsg)"
[ -f "$DATA/${SID}.start" ] && ok "start file written" || bad "start file missing"

echo "== end hook (with elapsed) =="
sleep 1
out="$(printf '%s' "$END_PAYLOAD" | bash "$END")"
is_json "$out" && ok "end emits valid JSON" || bad "end JSON ($out)"
endmsg="$(printf '%s' "$out" | jq -r '.systemMessage // empty' 2>/dev/null || true)"
printf '%s' "$endmsg" | grep -qE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2} · [0-9]+s\]$' && ok "end systemMessage is [time · elapsed] ($endmsg)" || bad "end systemMessage ($endmsg)"
[ -f "$DATA/${SID}.start" ] && bad "start file not cleaned up" || ok "start file cleaned up"

echo "== end hook (no prior start) =="
out="$(printf '%s' "$END_PAYLOAD" | bash "$END")"
endmsg="$(printf '%s' "$out" | jq -r '.systemMessage // empty' 2>/dev/null || true)"
printf '%s' "$endmsg" | grep -qE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]$' && ok "end without start shows time only ($endmsg)" || bad "end-without-start ($endmsg)"

echo "== disable switch =="
out="$(printf '%s' "$PAYLOAD" | CMAX_CLOCK_ENABLE=0 bash "$START")"
[ -z "$out" ] && ok "CMAX_CLOCK_ENABLE=0 emits nothing" || bad "disable switch leaked ($out)"

echo "== format + tz override =="
out="$(printf '%s' "$PAYLOAD" | CMAX_CLOCK_FORMAT='%H:%M' CMAX_CLOCK_TZ='UTC' bash "$START")"
sysmsg="$(printf '%s' "$out" | jq -r '.systemMessage // empty' 2>/dev/null || true)"
printf '%s' "$sysmsg" | grep -qE '^[0-9]{2}:[0-9]{2}$' && ok "format override applied ($sysmsg)" || bad "format override ($sysmsg)"

echo "== model-context opt-in =="
out="$(printf '%s' "$PAYLOAD" | CMAX_CLOCK_CONTEXT=1 bash "$START")"
ctx="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)"
printf '%s' "$ctx" | grep -q 'Turn started at' && ok "CMAX_CLOCK_CONTEXT=1 injects additionalContext" || bad "context opt-in ($ctx)"

# --- thinking stamp (MessageDisplay) -------------------------------------------
# NOTE: MessageDisplay's stdin schema is undocumented; rc_extract_display_text probes
# a set of plausible string fields. These tests use ".text" as a representative one.
echo "== thinking stamp (MessageDisplay) =="
TSID="think-$$"
printf '{"session_id":"%s"}' "$TSID" | bash "$START" >/dev/null   # seed start + clear markers
MD="$(printf '{"session_id":"%s","text":"Hello world"}' "$TSID")"
out="$(printf '%s' "$MD" | bash "$THINK")"
is_json "$out" && ok "thinking emits valid JSON" || bad "thinking JSON ($out)"
disp="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.displayContent // empty' 2>/dev/null || true)"
printf '%s' "$disp" | grep -qE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] Hello world$' && ok "thinking prepends [time] to first chunk ($disp)" || bad "thinking displayContent ($disp)"
out2="$(printf '%s' "$MD" | bash "$THINK")"
[ -z "$out2" ] && ok "thinking stamps once per turn (2nd chunk no-op)" || bad "thinking double-stamped ($out2)"

echo "== thinking fail-safe (unknown text field) =="
out="$(printf '{"session_id":"safe-%s","blob":{"nested":"x"}}' "$$" | bash "$THINK")"
[ -z "$out" ] && ok "no recognizable text -> emits nothing (text never dropped)" || bad "fail-safe leaked ($out)"

echo "== thinking disable switch =="
out="$(printf '%s' "$MD" | CMAX_CLOCK_THINKING=0 bash "$THINK")"
[ -z "$out" ] && ok "CMAX_CLOCK_THINKING=0 emits nothing" || bad "thinking disable leaked ($out)"

# --- first-tool stamp (PreToolUse) ---------------------------------------------
echo "== first-tool stamp (PreToolUse) =="
FSID="ftool-$$"
printf '{"session_id":"%s"}' "$FSID" | bash "$START" >/dev/null
PT="$(printf '{"session_id":"%s","tool_name":"Bash"}' "$FSID")"
out="$(printf '%s' "$PT" | bash "$FIRSTTOOL")"
is_json "$out" && ok "first-tool emits valid JSON" || bad "first-tool JSON ($out)"
ctx="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)"
printf '%s' "$ctx" | grep -q 'thinking finished at' && ok "first-tool injects thinking-finished context ($ctx)" || bad "first-tool context ($ctx)"
printf '%s' "$out" | jq -e '.hookSpecificOutput | has("permissionDecision") | not' >/dev/null 2>&1 && ok "first-tool never sets a permissionDecision (non-blocking)" || bad "first-tool touched permissionDecision"
out2="$(printf '%s' "$PT" | bash "$FIRSTTOOL")"
[ -z "$out2" ] && ok "first-tool stamps once per turn (2nd tool no-op)" || bad "first-tool double-stamped ($out2)"

echo
printf 'RESULT: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
