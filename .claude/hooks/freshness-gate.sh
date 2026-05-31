#!/usr/bin/env bash
# claudemax freshness-gate hook  — bash + python3 floor (searchoclock posture).
#
# Registered on SessionStart (load-bearing) + SubagentStop (observability-only).
# Context injection, never a blocker. Fail-open in every branch: exit 0 always,
# and the ONLY thing ever written to stdout is a single line of JSON.
#
# Two deterministic checks against .claudemax/memory.sqlite (read-only):
#   1. Stale ground truth — accepted invariant rows in `decisions` / `project_facts`
#      whose age (now - last_verified_at) exceeds COALESCE(ttl_days, 30).
#   2. Compile freshness — the `GROUNDING:BEGIN (generated YYYY-MM-DD ...)` marker
#      in root CLAUDE.md older than 14 days, or older than the newest accepted row.
#
# Emits {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"..."}}
# when something is stale; otherwise {}. Staleness reuses the existing
# last_verified_at mechanism (no parallel verified_on column). ttl_days is an
# optional per-row override of the 30-day default window.

set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"

ROOT="${CLAUDE_PROJECT_DIR:-${CMAX_ROOT:-$PWD}}"
DB="${CLAUDEMAX_DB:-$ROOT/.claudemax/memory.sqlite}"
CLAUDE_MD="$ROOT/CLAUDE.md"

if ! command -v python3 >/dev/null 2>&1; then
  echo '{}'
  exit 0
fi

if [ ! -f "$DB" ]; then
  echo '{}'
  exit 0
fi

python3 - "$DB" "$CLAUDE_MD" "$INPUT" <<'PY' || echo '{}'
import sys, json, sqlite3, datetime, re

DEFAULT_STALE_AFTER_DAYS = 30
COMPILE_STALE_DAYS = 14
MAX_CONTEXT_CHARS = 9000

db_path = sys.argv[1]
claude_md = sys.argv[2]
hook_input = sys.argv[3] if len(sys.argv) > 3 else ""

# hook_event_name drives hookSpecificOutput.hookEventName (mandatory or Claude
# Code rejects the payload). The script body is on stdin (python `-`), so the
# original hook event JSON is forwarded as an argv arg by the bash wrapper.
# Same script serves SessionStart + SubagentStop.
event = "SessionStart"
try:
    if hook_input.strip():
        payload = json.loads(hook_input)
        if isinstance(payload, dict):
            event = payload.get("hook_event_name") or event
except Exception:
    event = "SessionStart"


def emit(messages):
    if not messages:
        print("{}")
        return
    ctx = " ".join(m for m in messages if m)
    if len(ctx) > MAX_CONTEXT_CHARS:
        ctx = ctx[: MAX_CONTEXT_CHARS - 3] + "..."
    if not ctx.strip():
        print("{}")
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": ctx,
        }
    }))


def has_table(con, name):
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def cols(con, table):
    try:
        return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
    except Exception:
        return set()


messages = []
con = None
try:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    # ---- Check 1: stale ground truth -------------------------------------
    stale = []
    newest_accepted = None

    for table, ref, addr_col in (
        ("decisions", "decisions", "slug"),
        ("project_facts", "project_facts", "key"),
    ):
        if not has_table(con, table):
            continue
        c = cols(con, table)
        # The grounding columns are added by a separate migration step; if they
        # aren't present yet this table simply contributes nothing. Fail-open.
        if not {"status", "invariant", "last_verified_at"} <= c:
            continue
        has_ttl = "ttl_days" in c
        addr = addr_col if addr_col in c else "id"
        ttl_expr = "COALESCE(ttl_days, ?)" if has_ttl else "?"
        sql = (
            f"SELECT id, {addr}, "
            f"CAST(julianday('now') - julianday(last_verified_at) AS INT) AS age_days, "
            f"{ttl_expr} AS ttl, last_verified_at "
            f"FROM {table} "
            f"WHERE status='accepted' AND invariant=1 AND last_verified_at IS NOT NULL"
        )
        try:
            rows = con.execute(sql, (DEFAULT_STALE_AFTER_DAYS,)).fetchall()
        except Exception:
            rows = []
        for rid, addr_val, age_days, ttl, lva in rows:
            if lva and (newest_accepted is None or lva > newest_accepted):
                newest_accepted = lva
            if age_days is not None and ttl is not None and age_days > ttl:
                label = addr_val if addr_val is not None else rid
                stale.append((ref, rid, label, age_days, ttl))

    if stale:
        items = ", ".join(
            f"{ref}#{rid} ({age}d/{ttl}d)" for ref, rid, _label, age, ttl in stale
        )
        messages.append(
            f"{len(stale)} ground-truth item(s) past verify-by: {items}. "
            "Treat as assumptions and re-verify before relying on them; "
            "re-confirm then `cmax memory verify <ref>`."
        )

    # ---- Check 2: compile freshness --------------------------------------
    marker_date = None
    try:
        with open(claude_md, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(20000)
        m = re.search(r"GROUNDING:BEGIN\s*\(generated\s+(\d{4}-\d{2}-\d{2})", head)
        if m:
            marker_date = m.group(1)
    except Exception:
        marker_date = None

    if marker_date is not None:
        try:
            gen = datetime.date.fromisoformat(marker_date)
            age = (datetime.date.today() - gen).days
            stale_block = age > COMPILE_STALE_DAYS
            if not stale_block and newest_accepted:
                newest_date = newest_accepted[:10]
                try:
                    if datetime.date.fromisoformat(newest_date) > gen:
                        stale_block = True
                except Exception:
                    pass
            if stale_block:
                messages.append(
                    "CLAUDE.md invariants block is stale vs memory.sqlite "
                    f"(generated {marker_date}, {age}d ago) — run `cmax ground compile`."
                )
        except Exception:
            pass

    emit(messages)
except Exception:
    print("{}")
finally:
    try:
        if con is not None:
            con.close()
    except Exception:
        pass
PY

exit 0
