# response-clock

> A tiny quality-of-life Claude Code plugin that frames every response with a clock.

When you submit a prompt, response-clock prints the **local start time**. When the
response finishes, it prints the **local end time and how long it took**, in brackets:

```
17:07:53
… Claude's response …
[17:09:20 · 1m 27s]
```

That's it. No model cooperation, no API key, no runtime — just two shell hooks and
a per-session timestamp file. It works the same on your laptop and in Claude Code on
the web.

## Why

Long autonomous turns make you lose track of wall-clock time. The model can't reliably
tell you when it *finished* (it doesn't know its own stop instant), so response-clock
measures it from the outside with hooks that fire at the exact start and end of a turn.
You get an honest turn timer for free.

## How it works

| Hook | Fires | What it does |
|---|---|---|
| `UserPromptSubmit` → `stamp-start.sh` | the moment you submit | records `epoch` to a per-session file and shows the start time |
| `Stop` → `stamp-end.sh` | the moment the turn ends | reads the start file, prints end time `· elapsed`, deletes the file |

Both messages use the hook `systemMessage` channel, so they render to **you** and never
get injected into the model's context. The two hooks correlate via the `session_id`
that Claude Code passes on stdin, so concurrent sessions keep separate clocks.

## Install

### As a plugin (recommended)

```bash
# from a marketplace once published:
/plugin install response-clock@claude-community

# or test locally without installing:
claude --plugin-dir ./response-clock
```

### Standalone (drop into any project)

Copy `hooks/` into your repo and add this to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "hooks/stamp-start.sh", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "hooks/stamp-end.sh", "timeout": 5 }] }
    ]
  }
}
```

(`chmod +x hooks/*.sh` first.)

## Configure

Everything is env-driven; defaults are sensible, so configuration is optional.

| Variable | Default | Meaning |
|---|---|---|
| `CMAX_CLOCK_ENABLE` | `1` | master switch — `0` disables both hooks |
| `CMAX_CLOCK_SHOW_START` | `1` | show the start time |
| `CMAX_CLOCK_SHOW_ELAPSED` | `1` | append `· <elapsed>` to the end time |
| `CMAX_CLOCK_FORMAT` | `%H:%M:%S` | strftime for the displayed time (e.g. `%H:%M`) |
| `CMAX_CLOCK_TZ` | *(system)* | timezone override, e.g. `America/Argentina/Buenos_Aires` |
| `CMAX_CLOCK_EMOJI` | `0` | prefix the start line with 🕒 |
| `CMAX_CLOCK_START_PREFIX` | *(empty)* | custom prefix string for the start line |
| `CMAX_CLOCK_END_LABEL` | *(empty)* | text before the end time, e.g. `done ` → `[done 17:09:20 · 1m 27s]` |
| `CMAX_CLOCK_CONTEXT` | `0` | also tell the model the precise start instant (off by default) |

## Requirements

- `bash` and coreutils `date` (Linux or macOS). `jq` is used if present but **not required**.

## License

MIT — see [LICENSE](./LICENSE).
