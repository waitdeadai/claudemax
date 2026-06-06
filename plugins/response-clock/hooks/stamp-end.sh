#!/usr/bin/env bash
# response-clock — Stop hook.
# Reads the start time recorded by stamp-start.sh (keyed by session_id) and prints
# the local end time plus elapsed duration to the user, in brackets, e.g.
#   [17:09:20 · 1m 27s]
# Never blocks stopping — it only emits a user-visible systemMessage.
#
# Config (all optional, env-driven):
#   CMAX_CLOCK_ENABLE=1         master switch (0 disables both hooks)
#   CMAX_CLOCK_SHOW_ELAPSED=1   include "· <elapsed>" alongside the end time
#   CMAX_CLOCK_FORMAT=%H:%M:%S  strftime for the displayed time
#   CMAX_CLOCK_TZ=              TZ override
#   CMAX_CLOCK_END_LABEL=""     text before the end time, e.g. "done "
set -euo pipefail

[ "${CMAX_CLOCK_ENABLE:-1}" = "1" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_clock-lib.sh"

payload="$(rc_read_payload)"
session_id="$(rc_session_id "$payload")"

data_dir="$(rc_data_dir)"
start_file="$data_dir/${session_id}.start"

end_epoch="$(rc_now_epoch)"
end_disp="$(rc_now_disp)"

elapsed_str=""
if [ "${CMAX_CLOCK_SHOW_ELAPSED:-1}" = "1" ] && [ -f "$start_file" ]; then
  start_epoch="$(cat "$start_file" 2>/dev/null || true)"
  if printf '%s' "$start_epoch" | grep -qE '^[0-9]+$'; then
    elapsed_str=" · $(rc_fmt_elapsed "$((end_epoch - start_epoch))")"
  fi
fi
rm -f "$start_file" 2>/dev/null || true

label="${CMAX_CLOCK_END_LABEL:-}"
end_msg="[${label}${end_disp}${elapsed_str}]"

printf '{"systemMessage":"%s","suppressOutput":true}\n' "$(rc_json_escape "$end_msg")"
exit 0
