# Architecture

claudemax v0.2 is a three-layer harness on top of the Anthropic ecosystem.

## Layer 1 — Claude Code skills

26 markdown files in `.claude/skills/` that turn the harness into slash commands inside an interactive Claude Code session. See [SKILL_CATALOG.md](./SKILL_CATALOG.md) for the full lean catalog.

- 4 umbrellas (/cmax /workflow /opussonnet /opusolo).
- 22 primitives (5 research + 2 planning + 4 execution + 3 verification + 3 memory + 2 taste + 3 infra).

## Layer 2 — Programmatic runtime

A TypeScript monorepo that exposes the same protocol as a library + CLI:

```
packages/
  core/       — types, models, router, spec + multispec schema, cost (plan-aware)
  runtime/    — Claude Agent SDK query() wrappers: orchestrator (Mode A),
                agent-teams (Mode B), /goal driver, verifier, spec writer,
                multispec engine, deepresearch, taste, hive, council,
                agent-factory, overnight, billing
  memory/     — SQLite+FTS5 store, JSON snapshots
  cli/        — cmax binary (commander)
```

Use the runtime when you want autonomy without a Claude Code session in the loop — CI, cron, scheduled goals, programmatic embedding.

## Layer 3 — Hooks + dark patterns

- `.claude/hooks/cmax-session-start.sh` — injects taste.md + recent memory into every session.
- `.claude/hooks/cmax-stop.sh` — snapshots state, records episodes.
- `.claude/hooks/cmax-post-tool-use.sh` — file checkpoint snapshots for rollback.
- 31 dark-patterns hooks via [waitdeadai/llm-dark-patterns](https://github.com/waitdeadai/llm-dark-patterns) plugin — block vibes, emoji spam, aggregator hallucination, fake stats, fake citations, credential leaks, etc.

## Full data flow (default `cmax run`)

```
user goal
   │
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SessionStart hook → inject taste.md + taste.vision + recent memory     │
└─────────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────┐
│ /deepresearch       │  WebSearch + WebFetch (parallel) → source ledger
│ (Sonnet collects,   │  persisted to memory.research_sources
│  Opus synthesizes)  │
└─────────────────────┘
   │
   ▼
┌──────────────────────────┐
│ multispec decompose       │  Opus → MultiSpec: N sub-Specs + DAG + rollup
│ (Opus + json_schema)      │  conditions + writeSet per sub-Spec
└──────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────┐
│ /specqa     (parallel; Haiku per sub-Spec)           │
│ /introspect (parallel; Opus per sub-Spec)             │
└──────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Mode selection (auto-selector in multispec engine)         │
│ - ≤5 sub-Specs, <30min, no overlap → Mode A (SDK subagents) │
│ - >5 OR >30min OR cross-spec OR overlap → Mode B (Agent Teams) │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────┐
│ For each DAG leaf in parallel up to maxParallel cap: │
│   /goal (Opus driver wrapping Claude Code native /goal) │
│   → produces EVIDENCE block per sub-Spec             │
└──────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────────────┐
│ /verify per sub-Spec (parallel; blind Opus)        │
│ /verify rollup (blind Opus against rollup conds)   │
└────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────────────────────────────┐
│ Stop hook → snapshot state + record episode + digestflow → memory  │
└────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────────┐
│ Dark-patterns hooks gate the closeout      │
│ (no-vibes, no-aggregator-hallucination,    │
│  no-cherry-pick-rollup, no-emoji-spam, …)  │
└────────────────────────────────────────────┘
```

## Why three layers

- **Skills** = the protocol the user touches.
- **Runtime** = the engine that makes the protocol scriptable, schedulable, CI-able.
- **Hooks** = the lifecycle wiring that keeps state coherent across sessions and blocks bad outputs.

Both layers 1 and 2 share the same vocabulary: spec, multispec, packet, route, dispatch, goal, verify, parallel, hive, council. Changes in one update the other.

## Why Anthropic-only

Single provider means one pricing model, one auth path, one tool surface, one model family with predictable tier semantics. Multi-provider abstractions pay rent in complexity, prompt drift, and inconsistent tool behavior. The ICP is power users who have chosen Anthropic Max plans. Optimize hard for that.
