# response-clock

A zero-dependency quality-of-life plugin that frames every Claude Code response with
the local **start** time and, when the turn finishes, the local **end** time plus
elapsed duration in brackets:

```
17:07:53
… response …
[17:09:20 · 1m 27s]
```

It is shipped two ways from this monorepo:

1. **As an independent, submittable plugin** — `plugins/response-clock/` is a fully
   self-contained Claude Code plugin (`.claude-plugin/plugin.json` + `hooks/hooks.json`).
   It passes `claude plugin validate` and is intended for the community marketplace.
2. **Dogfooded in the harness** — `.claude/settings.json` wires the same two scripts
   directly: `stamp-start.sh` on `UserPromptSubmit`, `stamp-end.sh` on `Stop`.

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
