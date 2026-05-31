# Grounding layer

The grounding layer gives every freshly-spawned subagent — Mode A SDK subagents *and* Mode B Agent Teams teammates — a deterministic, dated, enforced source of truth, without re-feeding it by hand and without polluting its clean context.

The authoritative build contract is [`GROUNDING_LAYER_PLAN.md`](./GROUNDING_LAYER_PLAN.md) (repo-accurate, reconciled against the existing `packages/memory` store). The original design spec is `~/Music/GROUNDING_LAYER.md`. This doc is the short orientation.

## The principle

A spawned teammate loads `CLAUDE.md`, MCP servers, skills, and its spawn prompt — but **the lead's conversation history does NOT carry over**. So anything a subagent must treat as true has to live in a durable, addressable artifact. A source of truth is trustworthy for a *fresh* subagent only if it is:

1. **Addressable** — found deterministically (a slug, a key, an FTS query), not hoped-for in context.
2. **Dated** — staleness is detectable. Every row carries `last_verified_at`; reads compute `ageDays` and a `stale` flag against `ttl_days` (per-row override) or the 30-day default.
3. **Enforced** — `freshness-gate.sh` (SessionStart + SubagentStop) injects an assumptions-warning when invariants go stale; the `llm-dark-patterns` hooks (`no-vibes`, `no-fake-recall`, `no-fake-cite`) pressure the agent to label unsupported claims.

## Write once, read many

```
machine proposes  →  human blesses  →  compile promotes
```

- Agents only ever **append** dated rows to `memory.sqlite` with `status='proposed'`, via `cmax memory propose-decision` / `cmax memory propose-fact`. They never self-bless.
- A human reviews proposed rows in the Obsidian `vault/` (markdown in git) and sets `blessed: true`.
- `cmax ground compile` promotes blessed vault notes → `accepted` sqlite rows, then compiles `invariant=1` accepted rows into the `GROUNDING:BEGIN … END` managed block of the matching `CLAUDE.md`.

## The four tiers

| Tier | Artifact | Loaded how |
|------|----------|-----------|
| 0 — Run contract | `SPEC.md` / sub-Specs + verifyHints | spawn prompt, verbatim |
| 1 — Ambient truth | nested `CLAUDE.md` (+ compiled managed block) | auto-loaded by Claude Code |
| 2 — Learned truth | `.claudemax/memory.sqlite` (`decisions`, `project_facts`, `errors_solutions`) | on-demand via the read-only MCP |
| 3 — Human canonical | Obsidian `vault/` (markdown in git) | compiled into tiers 1 & 2 |

## The pieces

- **`packages/memory`** — the existing `better-sqlite3` + FTS5 store. The `decisions` table gained grounding columns (`slug`, `status`, `scope`, `invariant`, `ttl_days`, `source_path`, `tags`); a new `project_facts` table was added; staleness reuses `last_verified_at` + `verified_count`. Read methods: `getDecisionBySlug`, `getFact`, `staleTruth`, `searchGrounding`; write helpers: `proposeDecision`, `proposeFact`.
- **`packages/memory-mcp`** — read-only stdio MCP wrapping the store's read methods. Four tools, no `dump_all`. Registered for both modes (see [`MCP_SERVERS.md`](./MCP_SERVERS.md) + `.mcp.json` + the inline `mcpServers` in `orchestrator.ts`/`goal.ts`).
- **`packages/grounding`** — `cmax ground migrate | compile | export`: idempotent schema migration, vault→sqlite→CLAUDE.md compile, and sqlite→`vault/_inbox/` export of proposed rows for review.
- **`.claude/hooks/freshness-gate.sh`** — first-party hook (referenced directly in `settings.json`, not via `dp.sh`). Fail-open, exit 0, injects `additionalContext`, never blocks.
- **`.claude/agents/grounded-worker.md`** — the worker grounding contract. The runtime also prepends `GROUNDED_WORKER_CONTRACT` (in `packages/runtime/src/prompts.ts`) to every sub-Spec leaf spawn so Mode A and Mode B ground identically.
- **`vendor/searchoclock` (vendored hook) + `.claude/hooks/soc.sh`** — closes the write side of the loop: on a Bash failure it records the validated durable fix into `errors_solutions`, which `grounded-worker` later reads via `mcp__memory__memory_search`. See [`searchoclock.md`](./searchoclock.md).

## The contrarian rule

More memory ≠ better grounding. Dumping a memory blob into a fresh subagent pollutes the clean context that is the whole reason to isolate it. The MCP `limit` defaults low (8), tools require a `query`/`slug`/`key`, there is no dump-all tool, and the CLAUDE.md managed block carries only `invariant=1` accepted rows. The store is *queryable*; the subagent pulls the slice.
