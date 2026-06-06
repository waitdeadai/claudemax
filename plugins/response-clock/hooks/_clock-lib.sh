#!/usr/bin/env bash
# response-clock — shared helpers for the start/stop hooks.
# Sourced by stamp-start.sh and stamp-end.sh. Zero hard dependencies:
# jq is used when present, otherwise a POSIX grep/sed fallback extracts session_id.

# Read the whole stdin payload once (hooks always receive JSON on stdin).
rc_read_payload() {
  cat 2>/dev/null || true
}

# Extract session_id from the payload. jq if available, else a regex fallback.
# Prints the id, or "default" when none is found (keeps per-session files keyed).
rc_session_id() {
  local payload="$1" id=""
  if command -v jq >/dev/null 2>&1; then
    id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"
  fi
  if [ -z "$id" ]; then
    id="$(printf '%s' "$payload" \
      | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | head -1 \
      | sed 's/.*"\([^"]*\)"[[:space:]]*$/\1/' || true)"
  fi
  [ -n "$id" ] || id="default"
  # keep it filesystem-safe
  printf '%s' "$id" | tr -c 'A-Za-z0-9._-' '_'
}

# Resolve a writable data dir for the per-session start files.
# Prefers the plugin data dir; falls back to a temp dir for standalone/settings use.
rc_data_dir() {
  local d="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/response-clock}"
  if ! mkdir -p "$d" 2>/dev/null; then
    d="${TMPDIR:-/tmp}"
  fi
  printf '%s' "$d"
}

# Current epoch seconds, honouring an optional CMAX_CLOCK_TZ override.
rc_now_epoch() {
  if [ -n "${CMAX_CLOCK_TZ:-}" ]; then TZ="$CMAX_CLOCK_TZ" date +%s; else date +%s; fi
}

# Current local time string, honouring CMAX_CLOCK_TZ and CMAX_CLOCK_FORMAT.
rc_now_disp() {
  local fmt="${CMAX_CLOCK_FORMAT:-%H:%M:%S}"
  if [ -n "${CMAX_CLOCK_TZ:-}" ]; then TZ="$CMAX_CLOCK_TZ" date +"$fmt"; else date +"$fmt"; fi
}

# Humanise a duration in seconds: "8s", "1m 27s", "2h 5m".
rc_fmt_elapsed() {
  local s="$1"
  [ "$s" -lt 0 ] && s=0
  if [ "$s" -lt 60 ]; then printf '%ds' "$s"; return; fi
  if [ "$s" -lt 3600 ]; then printf '%dm %ds' "$((s / 60))" "$((s % 60))"; return; fi
  printf '%dh %dm' "$((s / 3600))" "$(((s % 3600) / 60))"
}

# Minimal JSON string escaper (backslash + double-quote; inputs are time/label only).
rc_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}
