# Parallelism — a pervasive principle

**Everything that can run in parallel, runs in parallel.** Sequential is the exception, justified only by genuine dependency (DAG order, same-file write contention, or downstream consumption of upstream output).

## Per-layer parallelism contract

| Layer | Parallel behavior | When sequential |
|---|---|---|
| Routing | Pure heuristic, zero I/O — N decisions computed concurrently | Never |
| `/deepresearch` | N WebSearch + WebFetch in flight; sources merged | Synthesis is one step after fan-in |
| `/spec` multispec decompose | One Opus call (decomposition is one reasoning act) | Always — this step produces the parallelism |
| `/specqa` | One parallel worker per sub-Spec (Haiku) | Never |
| `/introspect` | One parallel worker per sub-Spec (Opus) | Never |
| `/goal` (sub-Spec execution) | Every DAG-leaf at the current frontier in parallel, capped by maxParallel | Within a DAG path, sequential by definition |
| `/dispatch` | All packets in a parallelGroups slot concurrently up to cap | Cross-group with dependency only |
| `/verify` (per sub-Spec) | One blind Opus verifier per sub-Spec, in parallel | Never |
| `/verify` (rollup) | One blind Opus pass against rollup conditions | Always — final integration check |
| `/hive` | N proposers in parallel; merger after fan-in | Merger sequential by design |
| `/council` | Proposer + critic in 2 parallel Opus sessions; judge after | Judge sequential |
| `/audit /investigate /codesearch` | Multi-target searches fanned out concurrently | Synthesis after fan-in |
| Memory writes | SQLite WAL mode allows concurrent writes | Never |

## Two parallelism modes

Auto-selected by the multispec engine per spec shape.

### Mode A — SDK subagents (default, lighter)

ONE `query()` session delegates to N typed subagents via `agents: Record<string, AgentDefinition>` and the `Agent` tool. Orchestrator shares context; subagents get their own context windows.

- **When auto-selected**: ≤ 5 sub-Specs AND est. total time < 30 min AND no cross-spec coordination AND non-overlapping write sets.
- **Force**: `cmax run "..." --mode solo`.

### Mode B — Claude Code Agent Teams

Multiple full Claude Code *instances* coordinating via a shared task list with worktree isolation per instance. Released experimental in Claude Code v2.1.32; Agent View dashboard in v2.1.139.

- **When auto-selected**: > 5 sub-Specs OR est. total time > 30 min OR cross-spec coordination required OR overlapping write sets.
- **Force**: `cmax run "..." --mode teams`.
- **Mechanics**: shared task list at `.claudemax/state/agent-teams-<ts>/shared-task-list.md`; each session writes to `.claude/worktrees/<session-id>/` automatically on first write; Agent View dashboard surfaces live state.
- **Env var**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` (set automatically in `.claude/settings.json`).

See [AGENT_TEAMS.md](./AGENT_TEAMS.md) for the Mode B deep-dive.

## Hardware-aware + credit-aware parallel cap

`computeParallelCap()` (in `packages/runtime/src/orchestrator.ts`) takes the minimum of:

1. **Hardware cap**: 3 (≤ 4 cores), 6 (8–15 cores), 10 (≥ 16 cores).
2. `--max-parallel` env override if set.
3. **Credit-aware cap**: `floor((remaining monthly credit ÷ estimated per-packet credit) × 0.3)`. Prevents accidentally burning 80% of your Max credit on one fan-out.

Example on Max 20x with $200 credit, 6-core box, $0.40 per-packet estimate, $140 already consumed:
- hardware cap = 6
- credit-aware cap = floor((60 / 0.40) × 0.3) = 45
- effective = min(6, 45) = **6**

Same box but only $20 credit remaining:
- credit-aware cap = floor((20 / 0.40) × 0.3) = 15
- effective = **6**

Same box, $4 credit remaining:
- credit-aware cap = floor((4 / 0.40) × 0.3) = 3
- effective = **3**

## SDK-level parallel mechanics (what v0.2 adopted)

- `agents: Record<string, AgentDefinition>` — typed parallel subagents.
- `agentProgressSummaries: true` — per-subagent progress without polluting orchestrator context.
- `forwardSubagentText: true` — surface per-worker text blocks so the `no-aggregator-hallucination` dark-patterns hook can verify enumeration.
- `abortController` — SIGINT cancels all in-flight subagents.
- `forkSession` — explore N variants of a goal in parallel forks.
- `enableFileCheckpointing: true` — per-file rewind across subagents.
- `maxBudgetUsd` — built-in budget cap; prefer over reimplementing.

## Anti-patterns the harness prevents

- **Fake parallelism** (`Promise.all` over a single LLM session) — looks parallel, is actually serial because the model is shared.
- **Same-file write contention** — multispec decomposer annotates each sub-Spec's writeSet; engine serializes intersecting writeSets.
- **Aggregator hallucination** — dark-patterns `no-aggregator-hallucination` blocks "all N workers succeeded" claims without per-worker exit codes.
- **Cherry-pick rollup** — dark-patterns `no-cherry-pick-rollup` blocks "4 of 5 succeeded" + positive closeout without explicit failed-worker handling.
