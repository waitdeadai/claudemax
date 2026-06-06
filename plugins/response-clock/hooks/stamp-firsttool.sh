#!/usr/bin/env bash
# response-clock — PreToolUse hook.
# On the FIRST tool call of a turn — the model has finished its initial thinking and
# is about to act — surfaces the local time as additionalContext:
#   "response-clock: thinking finished at 17:30:36 (+1s)"
#
# PreToolUse cannot show a user-facing systemMessage, so this is the reliable,
# documented complement to the MessageDisplay stamp: it always fires on tool-using
# turns (even those with no preamble text). Deduped per turn via a marker, reset by
# stamp-start.sh at the next prompt. It NEVER blocks or alters the permission
# decision — it emits additionalContext only (no permissionDecision), so it composes
# with every other PreToolUse hook.
#
# Config (all optional, env-driven):
#   CMAX_CLOCK_ENABLE=1         master switch
#   CMAX_CLOCK_FIRSTTOOL=1      enable this first-action stamp
#   CMAX_CLOCK_FORMAT=%H:%M:%S  strftime for the time
#   CMAX_CLOCK_TZ=              TZ override
set -euo pipefail

[ "${CMAX_CLOCK_ENABLE:-1}" = "1" ] || exit 0
[ "${CMAX_CLOCK_FIRSTTOOL:-1}" = "1" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_clock-lib.sh"

payload="$(rc_read_payload)"
sid="$(rc_session_id_fast "$payload")"
data_dir="$(rc_data_dir)"
marker="$data_dir/${sid}.firsttool"

[ -e "$marker" ] && exit 0                  # already stamped this turn -> allow silently
: > "$marker" 2>/dev/null || true

now_disp="$(rc_now_disp)"
extra=""
if [ -f "$data_dir/${sid}.start" ]; then
  s="$(cat "$data_dir/${sid}.start" 2>/dev/null || true)"
  if printf '%s' "$s" | grep -qE '^[0-9]+$'; then extra=" (+$(( $(rc_now_epoch) - s ))s)"; fi
fi
msg="response-clock: thinking finished at ${now_disp}${extra}"

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg c "$msg" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$c}}'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' \
    "$(rc_json_escape "$msg")"
fi
exit 0
