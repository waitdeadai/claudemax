# response-clock

A zero-dependency quality-of-life plugin that frames every Claude Code response with
local timestamps at each phase of a turn:

```
17:07:53                         start (UserPromptSubmit)
[17:07:55] Here's the plan...     thinking finished, response begins (MessageDisplay)
[17:09:20 · 1m 27s]              end · elapsed (Stop)
```

It is shipped two ways from this monorepo:

1. **As an independent, submittable plugin** — `plugins/response-clock/` is a fully
   self-contained Claude Code plugin (`.claude-plugin/plugin.json` + `hooks/hooks.json`).
   It passes `claude plugin validate` and is intended for the community marketplace.
2. **Dogfooded in the harness** — `.claude/settings.json` wires the same scripts directly
   across four events: `stamp-start.sh` (`UserPromptSubmit`), `stamp-thinking.sh`
   (`MessageDisplay`), `stamp-firsttool.sh` (`PreToolUse`), `stamp-end.sh` (`Stop`).

## The four stamps

| Event | Script | Surface | Channel |
|---|---|---|---|
| `UserPromptSubmit` | `stamp-start.sh` | user | `systemMessage` |
| `MessageDisplay` | `stamp-thinking.sh` | user (first response line) | `displayContent`, display-only, fail-safe |
| `PreToolUse` | `stamp-firsttool.sh` | model | `additionalContext`, non-blocking |
| `Stop` | `stamp-end.sh` | user | `systemMessage` |

There is **no** Claude Code hook that fires exactly at "thinking finished," so the
transition is captured two ways: `MessageDisplay`'s first chunk (visible, the primary
stamp) and the first `PreToolUse` of the turn (reliable on tool-only turns). Both dedupe
to once per turn via per-session markers reset at the next prompt.

## Why hooks, not a prompt instruction

The model cannot reliably report its own *stop* instant — it doesn't know when
generation ends. response-clock measures both ends from the outside: the
`UserPromptSubmit` hook stamps the start, the `Stop` hook stamps the end. The two
correlate via the `session_id` Claude Code passes on stdin, written to a per-session
file under `$CLAUDE_PLUGIN_DATA` (or `$TMPDIR/response-clock` when run from settings).

Both messages use the hook `systemMessage` channel, so they render to the **user** and
are never injected into the model's context — they do not collide with the existing
`time-anchor.sh` (which injects model-visible `additionalContext`).

## Configuration

All env-driven; see `plugins/response-clock/README.md` for the full table. Common ones:

| Variable | Default | Effect |
|---|---|---|
| `CMAX_CLOCK_ENABLE` | `1` | master switch |
| `CMAX_CLOCK_FORMAT` | `%H:%M:%S` | time format |
| `CMAX_CLOCK_TZ` | system | timezone override |
| `CMAX_CLOCK_SHOW_ELAPSED` | `1` | append `· <elapsed>` |

## Test

```bash
bash plugins/response-clock/test/run.sh
```
