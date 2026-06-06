# response-clock

> A tiny quality-of-life Claude Code plugin that frames every response with local timestamps.

response-clock stamps the wall clock at each phase of a turn:

```
17:07:53                         ← you submit (start)
[17:07:55] Here's the plan...    ← thinking finished, response begins
[17:09:20 · 1m 27s]              ← turn ends (end · elapsed)
```

No model cooperation, no API key, no runtime — just shell hooks and a per-session
timestamp file. It works the same on your laptop and in Claude Code on the web.

## Why

Long autonomous turns make you lose track of wall-clock time. The model can't reliably
tell you when it *finished thinking* or *finished the turn* (it doesn't know its own
stream instants), so response-clock measures them from the outside with lifecycle hooks.
You get an honest, four-point turn timer for free.

## How it works

| Hook event | Script | Fires | What it shows |
|---|---|---|---|
| `UserPromptSubmit` | `stamp-start.sh` | you submit a prompt | the **start** time (and records `epoch` for elapsed) |
| `MessageDisplay` | `stamp-thinking.sh` | first visible chunk of the reply | prepends `[HH:MM:SS]` to the **first line** — the instant thinking ends |
| `PreToolUse` | `stamp-firsttool.sh` | first tool call of the turn | tells the model *“thinking finished at …”* (reliable on tool-only turns) |
| `Stop` | `stamp-end.sh` | the turn ends | the **end** time `· elapsed`, then clears the session files |

Notes on the design:

- **Start / end** use the `systemMessage` channel → shown to **you**, never injected into
  the model's context.
- **Thinking** uses `MessageDisplay` + `displayContent`, the only channel that can place a
  visible bracket at the response's first line. It is **display-only** (the saved transcript
  keeps the original text) and **strictly fail-safe**: it stamps once per turn and, if it
  can't read the chunk text, it emits nothing — your response text is never dropped or
  altered. `MessageDisplay` fires per streamed chunk, so the hook takes a near-instant
  fast path after the first stamp.
- **First-tool** is the documented complement for tool-heavy turns; it only adds
  `additionalContext` and never changes the permission decision, so it composes with other
  `PreToolUse` hooks.
- All four correlate via the `session_id` Claude Code passes on stdin, so concurrent
  sessions keep separate clocks.

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
    "MessageDisplay": [
      { "hooks": [{ "type": "command", "command": "hooks/stamp-thinking.sh", "timeout": 3 }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "hooks/stamp-firsttool.sh", "timeout": 5 }] }
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
| `CMAX_CLOCK_ENABLE` | `1` | master switch — `0` disables every hook |
| `CMAX_CLOCK_SHOW_START` | `1` | show the start time |
| `CMAX_CLOCK_THINKING` | `1` | prepend `[time]` to the first response line |
| `CMAX_CLOCK_FIRSTTOOL` | `1` | inject the “thinking finished” first-tool stamp |
| `CMAX_CLOCK_SHOW_ELAPSED` | `1` | append `· <elapsed>` to the end time |
| `CMAX_CLOCK_FORMAT` | `%H:%M:%S` | strftime for the displayed time (e.g. `%H:%M`) |
| `CMAX_CLOCK_TZ` | *(system)* | timezone override, e.g. `America/Argentina/Buenos_Aires` |
| `CMAX_CLOCK_EMOJI` | `0` | prefix the start line with 🕒 |
| `CMAX_CLOCK_START_PREFIX` | *(empty)* | custom prefix for the start line |
| `CMAX_CLOCK_END_LABEL` | *(empty)* | text before the end time → `[done 17:09:20 · 1m 27s]` |
| `CMAX_CLOCK_THINK_LABEL` | *(empty)* | text inside the thinking bracket before the time |
| `CMAX_CLOCK_THINK_ELAPSED` | `0` | also show `+<n>s` since the prompt in the thinking stamp |
| `CMAX_CLOCK_CONTEXT` | `0` | also tell the model the precise start instant |
| `CMAX_CLOCK_DEBUG` | `0` | append raw `MessageDisplay` payloads to `<data>/<sid>.msgdisplay.log` |

## Requirements

- `bash` and coreutils `date` (Linux or macOS).
- `jq` for the **thinking** stamp (safe escaping of arbitrary response text); the start /
  end / first-tool stamps fall back to a POSIX `grep`/`sed` path when `jq` is absent.

## License

MIT — see [LICENSE](./LICENSE).
