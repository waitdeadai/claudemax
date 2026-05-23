# shellcheck shell=bash
# haiku-judge.sh — Tier 3 Haiku-judge cascade for dark-patterns hooks.
#
# Sourced by hook scripts after Tier 1 (regex) and Tier 2
# (agentcloseout-physics) return AMBIGUOUS. Delegates the structured verdict
# to `cmax verdict-judge` (Haiku 4.5) and translates the response into a
# Claude Code hook decision.
#
# Contract:
#   haiku_judge_escalate "$payload_json"
#     - payload_json is the original hook stdin (Claude Code hook input).
#     - On success, emits one of four outcomes and returns 0 / exits 2:
#         BLOCK  -> exit 2, reason on stderr (hard block per CC convention)
#         REDACT -> stdout JSON {"decision":"block","reason":...}, return 0
#         WARN   -> stdout JSON {"decision":"ask","reason":...},   return 0
#         LOG    -> silent allow, return 0
#     - On any failure (missing CLI, non-zero exit, malformed verdict),
#       prints nothing and returns non-zero so the caller's regex/Tier-1
#       BLOCK remains authoritative. Fails CLOSED.
#
# Sourcing this file MUST NOT produce stdout/stderr or alter shell state
# beyond defining functions; callers source it unconditionally on every
# hook invocation.

_haiku_judge_invoke() {
    local payload="$1"
    command -v cmax >/dev/null 2>&1 || return 1
    local out
    out="$(printf '%s' "$payload" | cmax verdict-judge 2>/dev/null)" || return 1
    [ -n "$out" ] || return 1
    printf '%s' "$out"
}

_haiku_judge_field() {
    local json="$1" key="$2"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$json" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
        return
    fi
    printf '%s\n' "$json" \
        | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
        | sed -E "s/^\"$key\"[[:space:]]*:[[:space:]]*\"(.*)\"$/\1/" \
        | sed -E 's/\\"/"/g; s/\\\\/\\/g' \
        | sed -n '1p'
}

_haiku_judge_jsonesc() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

haiku_judge_emit_block() {
    local reason="${1:-blocked by Haiku judge}"
    printf '%s\n' "$reason" >&2
    exit 2
}

haiku_judge_emit_redact() {
    local reason="${1:-redacted by Haiku judge}"
    local esc
    esc="$(_haiku_judge_jsonesc "$reason")"
    printf '{"decision":"block","reason":"%s"}\n' "$esc"
    return 0
}

haiku_judge_emit_warn() {
    local reason="${1:-warned by Haiku judge}"
    local esc
    esc="$(_haiku_judge_jsonesc "$reason")"
    printf '{"decision":"ask","reason":"%s"}\n' "$esc"
    return 0
}

haiku_judge_emit_log() {
    return 0
}

haiku_judge_escalate() {
    local payload="$1"
    local verdict_json
    verdict_json="$(_haiku_judge_invoke "$payload")" || return 1

    local verdict reason
    verdict="$(_haiku_judge_field "$verdict_json" "verdict")"
    reason="$(_haiku_judge_field "$verdict_json" "reason")"

    [ -n "$verdict" ] || return 1

    case "$verdict" in
        BLOCK)  haiku_judge_emit_block  "$reason" ;;
        REDACT) haiku_judge_emit_redact "$reason" ;;
        WARN)   haiku_judge_emit_warn   "$reason" ;;
        LOG)    haiku_judge_emit_log    "$reason" ;;
        *)      return 1 ;;
    esac
}
