---
name: ask
description: Ask. Achieve. The canonical user-facing entry to claudemax — describe your goal, the SOTA-2026 pipeline (deepresearch → multispec → parallel /goal → verify) handles the rest. Same engine as /cmax with a friendlier verb. CLI equivalent is `cmax ask "<goal>"`.
---

# /ask — describe your goal, achieve it

The user-facing entry point. You describe what you want; the pipeline produces it.

> CLI equivalent: `cmax ask "<your goal>"` — same engine as `/cmax` and `cmax run`.

## What runs (auto, no flags)

1. **Taste check** — read `taste.md` + `taste.vision` if present. Suggest `cmax taste init` if absent and the repo has signal.
2. **/deepresearch** — web-current research with source ledger persisted to `memory.research_sources`.
3. **multispec decompose** — Opus authors a MultiSpec: N sub-Specs + DAG + rollup completion conditions + per-sub-Spec writeSet.
4. **/specqa** (parallel per sub-Spec) — gate spec quality (every verifyHint mechanically checkable).
5. **/introspect** (parallel per sub-Spec) — confidence/assumption gate. Blocks at confidence < 6.
6. **Mode selection** — Mode A (SDK subagents in one query()) for ≤ 5 sub-Specs / short runs; Mode B (Claude Code Agent Teams with shared task list + worktree isolation) for big swarms or write-set overlap.
7. **Parallel /goal** per DAG leaf — Sonnet by default; Opus on router escalations (security, novelty, complexity ≥ 7).
8. **Per-sub-Spec /verify** (parallel, blind Opus) — re-reads repo, runs verifyHints.
9. **Rollup /verify** — blind Opus checks integration conditions across all sub-Spec outputs.
10. **Memory record** + state snapshot. ntfy.sh push to phone if `NTFY_TOPIC` is set.

Bundled dark-patterns hooks block vibes, fake citations, aggregator hallucination, and credential leaks throughout.

## Variants (when you need to deviate)

`/ask` runs `/opussonnet` semantics by default (Opus plan/judge/verify + Sonnet exec). For other shapes, use the explicit skill:

- `/opusolo <goal>` — all-Opus exec for novel/security/payments/auth (~3× cost, max effectiveness).
- `/cmax <goal>` — same as `/ask`; the brand umbrella.
- `/workflow <goal>` — v1 muscle-memory alias.
- `/opussonnet <goal>` — explicit v1 muscle-memory invocation.

CLI overrides on `cmax run`:

```bash
cmax run "<goal>" --variant opusolo
cmax run "<goal>" --mode teams
cmax run "<goal>" --no-research
cmax overnight SPEC.md --budget-credits 50
```

## When NOT to invoke /ask

- Trivial one-line changes — just edit.
- A single SPEC that fits in one /goal loop — invoke `/goal` directly on the existing SPEC.md.
- Pure research with no implementation — invoke `/deepresearch` directly.
