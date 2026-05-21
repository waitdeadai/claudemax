---
name: resume
description: Resume a paused `cmax mega` run. Picks up only the lanes still pending or paused; skips finished. cron-friendly — exits 0 with no-op if nothing to do. Use after a saturation pause, or wire into systemd timer for fully-unattended resume across rate-limit windows.
---

# /resume — pick up where mega paused

> CLI: `cmax resume [run-id]` — omit run-id to use the latest run in cwd.

## Behavior

1. Locates the most recent `.claudemax/state/resumable/run-*/state.json` if no run-id given.
2. Reads the state. If `isComplete(state)` → exits 0, prints "already complete".
3. Otherwise filters lanes to those with status `pending`, `running`, or `paused` and re-fires them via the same driveLanes path as `cmax mega`.
4. Honors the original run's `--variant`, `--confidence`, `--mode`, `--tdd` flags (persisted in the state).
5. `--max-parallel N` overrides the stored lane count (useful if your envelope has shrunk).

## When to use /resume

- Right after a `cmax mega` rollup shows `paused: N` lanes.
- As the body of a systemd timer / cron job that fires periodically until the run completes.

## When NOT to use /resume

- The run already finished — `/resume` is a no-op. (`cmax mega` is the right entry for new goals.)
- You want to re-attempt a `failed` lane — that requires changing the SPEC or the lane's flags, not just resuming. Edit `state.json` to set the lane back to `pending` if you want a retry.

## Cron-friendly contract

Exit codes:
- `0` — no pending lanes (timer-safe; will keep firing harmlessly).
- `1` — completed with some failures.
- `2` — re-paused (saturation hit again; timer should fire later).

## Systemd integration

See `infra/cmax-resume.{service,timer}` and `docs/RESUMABLE_CRON.md`.
