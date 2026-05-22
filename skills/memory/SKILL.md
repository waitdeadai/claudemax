---
name: memory
description: Durable cross-session memory for claudemax. SQLite+FTS5 hybrid-retrieval store with 5-tier CoALA taxonomy, multi-scope identity, and staleness handling. Use `recall` before claiming prior-session facts, `add` to record durable lessons, `verify` to refresh a recalled row.
---

# /memory — durable cross-session memory

Hybrid-retrieval SQLite+FTS5 store built on the SOTA-2026 evidence base. Replaces v1's flat-file Obsidian mirror; **anti-pattern** to dual-write into a Markdown tree (Letta 2025-08-12 finding: filesystem alone is sufficient).

## Three verbs

```bash
cmax memory recall "<task>" [--depth simple|medium|deep] [--lane LANE] [--run RUN] [--no-stale]
cmax memory add <tier> "<content>" [--title T] [--tags T1,T2] [--lane LANE] [--run RUN]
cmax memory verify <source>#<id> [--by <agent-name>]
```

Plus utility commands `search`, `runs`, `credit`, `drain` (queue → SQLite).

## When to use which verb

| Situation | Verb |
|---|---|
| "Did we decide X already?" / "What did we learn about Y last week?" | `recall` first. Quote the row verbatim or say "no recall". |
| You made a non-obvious architectural call. | `add decision "<body>" --lane <id>` |
| You debugged an error whose fix wasn't obvious from the stack trace. | `add error-solution "<sig> :: <fix>"` |
| You discovered a code pattern that's worth reusing. | `add pattern "<name>" "<body>"` |
| A general note about this session's work. | `add episode "<one-line note>"` |
| You followed a recalled row and it turned out correct. | `verify <source>#<id> --by <agent>` |
| Lane-spawn moment writes to memory; want async to avoid blocking. | append to `.claudemax/memory.queue.jsonl`, then `cmax memory drain` later |

## Recall depth (SOTA-2026)

| Depth | Limit | Use |
|---|---|---|
| `simple` | 5 hits | Quick "is there anything on X?" check |
| `medium` | 15 hits (default) | Standard session-start recall |
| `deep` | 50 hits | Investigations / archaeology |

Composite score is **BM25 + entity-match boost + recency decay + recently-verified boost − staleness penalty**. Mem0's 2026-05-21 SOTA report identifies multi-signal hybrid retrieval as a winning architecture vs pure semantic similarity.

## CoALA 5-tier taxonomy

Based on arxiv 2309.02427 (Cognitive Architectures for Language Agents). The harness maps each tier to a SQLite table:

| Tier | Table | What goes in |
|---|---|---|
| `episode` | episodes | Session-scoped events: "started X", "blocked on Y", "session ended with Z passing" |
| `decision` | decisions | Architectural calls + their rationale |
| `pattern` | patterns | Recurring named code patterns + the body |
| `error-solution` | errors_solutions | Stack-trace-like signature + the fix |
| `graph` | episodes (kind='graph') | Multi-step stories with relationships |

## Multi-scope identity

Every memory row carries optional `run_id`, `lane_id`, `user_id`, `app_id`. This is the **Mem0 winning architecture** (May 21 2026). Use these to:

- Filter recall to one mega-lane: `cmax memory recall "auth" --lane infra-lane-implement-apps-webhook-dispat`
- Filter recall to one run: `--run run-1779392855991`
- Cross-lane queries: omit both for the global view

## Staleness handling

Rows whose `last_verified_at` is older than 30 days (configurable) get a **[STALE]** flag on recall. Calling `cmax memory verify <ref>` refreshes the timestamp and bumps a verified-count. This is the harness's answer to the **#1 unsolved problem in 2026 agent memory** (Mem0 SOTA report).

`--no-stale` excludes stale rows entirely. Default is to include them with the flag so you can decide.

## Tool rules (Letta finding)

Subagent system prompts in v0.2.3+ include a **memory tool rule**:

> Before claiming any fact about prior sessions, prior decisions, or "what we did last time", call `cmax memory recall "<topic>" --depth medium` first.

Backed by **Letta's 2025-08-12 finding** that agents constrained by tool rules outperform unconstrained agents (LoCoMo 74.0% vs 68.5%). Complements the dark-patterns `no-fake-recall.sh` hook which blocks "as we discussed earlier"-shaped claims at Stop time.

## Per-lane features.json (Anthropic Nov 26 2025 pattern)

Separate from durable memory but adjacent. When you spawn `cmax mega --features-checklist`, each lane gets a `.claudemax/lanes/<lane-id>/features.json` checklist. Subagents:

1. Read the file at session start.
2. Pick the FIRST feature with `passes: false`.
3. Implement only that one. Commit. Set `passes: true`. Exit.

JSON not Markdown because per Anthropic: *"the model is less likely to inappropriately change or overwrite JSON files."*

## What NOT to store

- Source code itself (it's in git).
- Anything derivable from `git log` / `git blame`.
- Ephemeral conversation context (use `.no-amnesia/state/CURRENT.md` working-state for that).
- Prompt restates / running commentary.
- Anything CLAUDE.md or the SPEC already says.

## SOTA-2026 source ledger

All accessed 2026-05-21:

- Anthropic **Effective harnesses for long-running agents** (2025-11-26): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — JSON feature checklist + initializer/coding agent split
- Anthropic **Effective context engineering for AI agents** (2025-09-29): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — file-based Memory tool, structured note-taking, compaction-first lever
- **Mem0 State of AI Agent Memory 2026** (2026-05-21): https://mem0.ai/blog/state-of-ai-agent-memory-2026 — multi-scope identity, async-by-default writes, multi-signal retrieval, staleness as #1 unsolved problem
- **Letta "Is a Filesystem All You Need?"** (2025-08-12): https://www.letta.com/blog/benchmarking-ai-agent-memory — filesystem beats specialized memory tools; tool rules materially help
- **CoALA: Cognitive Architectures for Language Agents** (arxiv 2309.02427): https://arxiv.org/html/2309.02427v3 — 4-type taxonomy (working/episodic/semantic/procedural); our 5-tier surface adds graph
