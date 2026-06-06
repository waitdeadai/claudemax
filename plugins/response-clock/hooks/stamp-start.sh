#!/usr/bin/env bash
# response-clock — UserPromptSubmit hook.
# Records the local turn-start time (keyed by session_id) and surfaces it to the
# user as the opening frame of the response. The matching Stop hook (stamp-end.sh)
# reads the recorded start to print the end time + elapsed duration in brackets.
#
# Config (all optional, env-driven):
#   CMAX_CLOCK_ENABLE=1        master switch (0 disables both hooks)
#   CMAX_CLOCK_SHOW_START=1    show the start time to the user
#   CMAX_CLOCK_FORMAT=%H:%M:%S strftime for the displayed time
#   CMAX_CLOCK_TZ=             TZ override (e.g. America/Argentina/Buenos_Aires)
#   CMAX_CLOCK_EMOJI=0         prefix the start line with a clock emoji
#   CMAX_CLOCK_START_PREFIX="" custom prefix string (overridden by emoji)
#   CMAX_CLOCK_CONTEXT=0       also tell the model the precise start instant
set -euo pipefail

[ "${CMAX_CLOCK_ENABLE:-1}" = "1" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_clock-lib.sh"

payload="$(rc_read_payload)"
session_id="$(rc_session_id "$payload")"

data_dir="$(rc_data_dir)"
start_file="$data_dir/${session_id}.start"

now_epoch="$(rc_now_epoch)"
now_disp="$(rc_now_disp)"
printf '%s' "$now_epoch" > "$start_file" 2>/dev/null || true

prefix="${CMAX_CLOCK_START_PREFIX:-}"
[ "${CMAX_CLOCK_EMOJI:-0}" = "1" ] && prefix="🕒 "
start_msg="${prefix}${now_disp}"

# Build the JSON output. additionalContext (model-visible) is opt-in so it does
# not duplicate an existing time-anchor; systemMessage (user-visible) is the frame.
ctx_field=""
if [ "${CMAX_CLOCK_CONTEXT:-0}" = "1" ]; then
  ctx="Turn started at ${now_disp} local time."
  ctx_field=",\"additionalContext\":\"$(rc_json_escape "$ctx")\""
fi

if [ "${CMAX_CLOCK_SHOW_START:-1}" = "1" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit"%s},"systemMessage":"%s","suppressOutput":true}\n' \
    "$ctx_field" "$(rc_json_escape "$start_msg")"
elif [ -n "$ctx_field" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit"%s},"suppressOutput":true}\n' "$ctx_field"
fi

exit 0
