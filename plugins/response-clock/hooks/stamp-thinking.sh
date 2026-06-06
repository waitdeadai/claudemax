#!/usr/bin/env bash
# response-clock — MessageDisplay hook.
# Prepends the local time in brackets to the FIRST visible chunk of the response —
# the instant the model finishes thinking and starts emitting text:
#   [17:30:35] Here's the answer ...
#
# MessageDisplay fires once per streamed chunk, so this stamps only ONCE per turn
# (a per-session marker, reset by stamp-start.sh at the next prompt) and takes a
# near-instant fast path on every later chunk. It is strictly FAIL-SAFE: if it
# cannot extract the chunk's text it emits nothing, so the original text displays
# unchanged and is never dropped or corrupted. The change is display-only
# (`displayContent`) — the saved transcript and the model's context keep the original.
#
# Config (all optional, env-driven):
#   CMAX_CLOCK_ENABLE=1         master switch (0 disables every response-clock hook)
#   CMAX_CLOCK_THINKING=1       enable this response-start stamp
#   CMAX_CLOCK_FORMAT=%H:%M:%S  strftime for the displayed time
#   CMAX_CLOCK_TZ=              TZ override
#   CMAX_CLOCK_THINK_LABEL=""   text inside the bracket before the time
#   CMAX_CLOCK_THINK_ELAPSED=0  also show "+<n>s" since the prompt
#   CMAX_CLOCK_DEBUG=0          append raw payloads to <data>/<sid>.msgdisplay.log
#                               (use this to confirm the real MessageDisplay schema)
set -euo pipefail

[ "${CMAX_CLOCK_ENABLE:-1}" = "1" ] || exit 0
[ "${CMAX_CLOCK_THINKING:-1}" = "1" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0   # safe escaping of arbitrary text needs jq

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_clock-lib.sh"

payload="$(rc_read_payload)"
sid="$(rc_session_id_fast "$payload")"
data_dir="$(rc_data_dir)"
marker="$data_dir/${sid}.thinking"

# Fast path: already stamped this turn -> emit nothing, original chunk shows as-is.
[ -e "$marker" ] && exit 0

if [ "${CMAX_CLOCK_DEBUG:-0}" = "1" ]; then
  printf '%s\n' "$payload" >> "$data_dir/${sid}.msgdisplay.log" 2>/dev/null || true
fi

orig="$(rc_extract_display_text "$payload")"
[ -n "$orig" ] || exit 0                   # unknown text field -> fail-safe pass-through

now_disp="$(rc_now_disp)"
extra=""
if [ "${CMAX_CLOCK_THINK_ELAPSED:-0}" = "1" ] && [ -f "$data_dir/${sid}.start" ]; then
  s="$(cat "$data_dir/${sid}.start" 2>/dev/null || true)"
  if printf '%s' "$s" | grep -qE '^[0-9]+$'; then extra=" +$(( $(rc_now_epoch) - s ))s"; fi
fi
prefix="[${CMAX_CLOCK_THINK_LABEL:-}${now_disp}${extra}] "

: > "$marker" 2>/dev/null || true          # stamp once; best-effort guard vs double-prefix

jq -nc --arg p "$prefix" --arg c "$orig" \
  '{hookSpecificOutput:{hookEventName:"MessageDisplay",displayContent:($p + $c)}}'
exit 0
