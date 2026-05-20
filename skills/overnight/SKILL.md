---
name: overnight
description: Long-running mode with file checkpointing + session resumption. `cmax overnight <spec> --budget-credits N` runs until the spec is done or the budget is exhausted, snapshotting on every turn so a SIGTERM or crash doesn't lose work.
---

# /overnight — long-running mode

For multi-hour or multi-day autonomous runs. Combines /goal with file checkpointing and session resumption.

## Mechanics

- Runs /goal loop with `enableFileCheckpointing: true`.
- Snapshots session ID + cumulative credit usage to `.claudemax/state/overnight/<slug>.checkpoint.json` after every meaningful turn.
- On crash / SIGTERM / max-turns hit, re-running `cmax overnight <spec>` picks up from the last checkpoint.
- Hard budget cap via `--budget-credits N` (Agent SDK credit, USD). Run terminates when budget hit.

## CLI

```
cmax overnight SPEC.md --budget-credits 50
cmax overnight SPEC.md --budget-credits 50 --max-turns 500
```

## When to use

- A multi-hour migration you want to start before bed.
- A big test suite that takes hours to debug.
- Any /goal run where you'd rather come back to results than babysit turns.

## When NOT to use

- Quick tasks — overnight overhead (checkpointing) costs you turn latency.
- Tasks where you genuinely need to babysit (security-sensitive, irreversible) — use plain /goal instead.

## What's preserved across restarts

- Session ID (Claude Code resume).
- Cumulative credit usage.
- File checkpoints (SDK feature; per-file rewind possible).

## What's NOT preserved

- In-memory orchestrator state. /overnight assumes the SPEC is the source of truth — re-reading SPEC.md + the session is enough to resume.
