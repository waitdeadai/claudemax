---
kind: fact
key: parallelism.modes
value: Two parallelism modes, auto-selected. Mode A = SDK subagents in one query() (small/short work). Mode B = Claude Code Agent Teams with shared task list + worktree isolation (big multi-day swarms). Override with `--mode {auto|solo|teams}`. Mode B sub-Specs dispatch via a DAG-aware bounded-parallel active-set capped by MAX_PARALLEL_AGENTS or os.cpus().length.
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-05-31
ttl_days: 365
confidence: 5
tags: [parallelism, mode-a, mode-b, agent-teams]
source: CLAUDE.md
---

The harness has exactly two parallelism modes and auto-selects between them by
work size:

- **Mode A** — SDK subagents inside a single `query()`. For small/short work.
- **Mode B** — Claude Code Agent Teams: multiple full Claude Code instances
  coordinating via a shared task list, worktree isolation, and the Agent View.
  For big multi-day swarms.

Override with `--mode {auto|solo|teams}`. In Mode B, independent leaf sub-Specs
dispatch concurrently through a `Promise.race(active)` active-set capped by the
`MAX_PARALLEL_AGENTS` env var or `os.cpus().length`; dependency chains serialize;
cycle-stuck sub-Specs fail-fast rather than deadlock
(`packages/runtime/src/agent-teams.ts`).
