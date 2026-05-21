---
name: orchestrate
description: Multi-goal harness — runs N `/cmax` pipelines in parallel for DIFFERENT goals at the same time. Each goal gets its own deepresearch → multispec → /goal → blind /verify, independent state, independent verdict. Rollup status at end. Effectiveness-driven defaults (--tdd --confidence 0.85). Use when you have several distinct things to ship at once and don't want to babysit them sequentially. Distinct from /parallel (which fans out one goal across N sub-Specs) and /hive (which gives N agents the SAME problem).
---

# /orchestrate — N /cmax pipelines, one command

Ask for several things at once. Each gets its own full pipeline; they run in parallel.

> CLI equivalent: `cmax orchestrate "<goal A>" "<goal B>" "<goal C>"` — or `cmax multi ...`

## Pipeline (per goal, in parallel)

For each goal you provide, the orchestrator spawns a `cmax ask "<goal>" --tdd --confidence 0.85` subprocess. Each subprocess runs the standard `/cmax` pipeline independently:

1. /deepresearch
2. multispec decompose
3. /specqa + /introspect gates
4. Parallel /goal per DAG leaf
5. Per-sub-Spec /verify (blind Opus)
6. Rollup /verify

Each goal writes to its own memory dir (`.claudemax/state/orchestrator-<ts>/<goal-id>.memory.sqlite`) so they don't collide.

## Live status

A status table updates every 5 seconds (configurable via `--tick-ms`):

```
─── status @ 03:14:22 ───
  running    142s  add-health-endpoint-with-tests        add a /health endpoint that returns build sha…
  running    138s  migrate-user-model-to-drizzle         migrate the user model to drizzle, preserve a…
  finished    97s  add-otel-to-the-worker                add OpenTelemetry instrumentation to the wor…
```

## Rollup verdict

`all-finished` (every goal shipped clean) / `partial` (some did, some didn't) / `all-failed`. Exit 0 only on `all-finished`.

## Flags

| Flag | Default | Effect |
|---|---|---|
| `--goals-file <path>` | (none) | Read newline-separated goals from a file (in addition to positional args) |
| `--max-parallel <n>` | all | Cap concurrent subprocesses. Default = run all goals in parallel |
| `--variant opussonnet\|opusolo` | opussonnet | Per-goal exec tier — opusolo is ~3× cost, max effectiveness |
| `--mode auto\|solo\|teams` | auto | Per-goal parallelism mode for the inner multispec |
| `--no-tdd` | (TDD on) | Skip the TDD enforcement inside each goal |
| `--confidence <n>` | 0.85 | Verifier confidence threshold per goal |
| `--tick-ms <n>` | 5000 | Live status refresh interval |

## When to invoke /orchestrate

- You have several distinct features / fixes / migrations to ship and don't want to do them sequentially.
- Overnight: queue 5–10 goals before bed, wake up to a rollup verdict.
- You're evaluating which approach works — give 2-3 phrasings of the same goal, see which ones the verifier accepts.

## When NOT to invoke /orchestrate

- One goal: just use `/cmax` or `cmax ask`.
- Goals that touch the same files heavily (writeSet overlap across goals → merge conflicts). Run them sequentially instead.
- You haven't yet exercised `cmax ask` against your billable pool once. Validate the single-goal path first.

## Pre-split era warning (today, until 2026-06-15)

Per [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) (accessed 2026-05-21): until 2026-06-15, every `cmax ask` consumes your shared 5-hour rolling subscription pool. **N parallel goals = N× faster envelope burn.** Use a small N first (2–3) to feel the cost before queuing 10. After 2026-06-15 the harness auto-switches to the dedicated monthly Agent SDK credit pool.

## Differentiation from sibling skills

- **`/orchestrate` vs `/parallel`**: /orchestrate runs N DIFFERENT goals (different deepresearch, different multispec each). /parallel fans out ONE goal into distinct packets.
- **`/orchestrate` vs `/hive`**: /orchestrate gives N distinct problems to N pipelines. /hive gives the SAME problem to N agents and merges their proposals.
- **`/orchestrate` vs `/cmax`**: /cmax is one pipeline for one goal. /orchestrate is N parallel /cmax invocations.
