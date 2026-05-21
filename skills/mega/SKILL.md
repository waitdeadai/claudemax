---
name: mega
description: Session-limit-aware mega-build orchestrator. One command takes N goals, auto-sizes parallel lanes from your hardware (os.availableParallelism + free RAM) and plan tier, runs each as an independent cmax-run subprocess with checkpointing, pauses cleanly on rate-limit saturation, and can be resumed by `cmax resume` (cron-friendly). Distinct from `/orchestrate` (no auto-sizing, no resume), `/parallel` (one goal split into packets), and `/hive` (same problem to N agents). Use when you have many independent goals to ship and want the harness to manage the envelope for you.
---

# /mega — session-limit-aware mega-build

One command. Many goals. Hardware + plan + saturation-aware. Resumable.

> CLI: `cmax mega "<goal A>" "<goal B>" ...` or `cmax mega --goals-file goals.txt`

## What it does

1. **Probes hardware** — `os.availableParallelism()` (Node 19.4+ — picks up cgroup/container CPU limits), `os.freemem()`, `os.loadavg()`.
2. **Probes plan** — calls `detectPlan()` to read your Claude Max tier (max5x / max20x / pro / api).
3. **Derives lane count** — `min(availableParallelism, floor(freeMemGB / 1.5), PLAN_CAP)`; halves on thermal back-pressure (load-average > 0.8 × parallelism). Override with `--max-parallel N`.
4. **Spawns N parallel `cmax run` subprocesses** — one per goal, each writes to its own memory db and state dir.
5. **Captures saturation signals** — watches each lane's stdout for rate-limit-shaped output (Anthropic SDK `rate_limit_event` messages with `utilization >= 0.85` on `five_hour` or `seven_day_opus` buckets).
6. **Pauses cleanly on saturation** — writes a resumable checkpoint to `.claudemax/state/resumable/<run-id>/state.json`; exits 2 (paused).
7. **Resumable** — `cmax resume <run-id>` picks up the pending/paused lanes. cron-friendly: exits 0 with no-op if nothing to do.

## Output

A persistent state directory:
```
.claudemax/state/resumable/run-<ts>/
├── state.json          # ResumableState — per-lane status + flags
├── summary.md          # human-readable run summary + resume command
└── <lane-id>.memory.sqlite
```

The mega rollup at the end prints: finished / paused / failed counts and the exact `cmax resume <run-id>` command to continue if anything paused.

## Defaults (effectiveness-steered)

| Setting | Default | Why |
|---|---|---|
| `--variant` | `opussonnet` | Opus plan/judge/verify + Sonnet exec; effectiveness ceiling without 3× cost |
| `--confidence` | `0.85` | verifier suppresses findings below 0.85; eliminates verifier noise |
| `--tdd` | on (`--no-tdd` to opt out) | write-failing-test-first per sub-Spec where a test verifyHint exists |
| `--mode` | `auto` | Mode A / Mode B selected by multispec engine |
| lane count | auto | hardware + plan; override with `--max-parallel` |

## When to use /mega vs siblings

| Skill | Use when |
|---|---|
| `/mega` | Many independent goals (3+); want auto-sized lanes + resumable across rate-limit windows |
| `/orchestrate` | Many independent goals; want fixed lane count and to babysit the run |
| `/parallel` | ONE goal that decomposes into N packets in the same workspace |
| `/hive` | SAME problem given to N agents, merge proposals |
| `/cmax` (default) | ONE goal, single multispec |

## systemd timer integration

For unattended resume after rate-limit windows refresh:

```bash
sudo cp infra/cmax-resume.service /etc/systemd/system/
sudo cp infra/cmax-resume.timer   /etc/systemd/system/
sudo systemctl enable --now cmax-resume.timer
systemctl status cmax-resume.timer
```

Timer fires at `OnUnitActiveSec=30min` with `RandomizedDelaySec=5min` jitter. Service exits 0 if no pending lanes (timer just fires again later). See `docs/RESUMABLE_CRON.md` for details.

## Pre-split era warning (today, until 2026-06-15)

Per Anthropic primary docs (accessed 2026-05-21): `cmax run`/`cmax mega` calls consume your shared 5h rolling subscription pool. The 0.85 saturation threshold on `five_hour` events is your safety belt. After 2026-06-15 the SDK calls move to a separate monthly Agent SDK credit pool; the threshold semantics carry over automatically.
