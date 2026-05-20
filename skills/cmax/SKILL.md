---
name: cmax
description: The default FAT umbrella. Auto-runs deepresearch + multispec decomposition + parallel /goal + verify. Opus for planning/judgment/verification; Sonnet for sub-Spec execution (escalates per router). Multispec engine selects Mode A (SDK subagents) or Mode B (Claude Code Agent Teams) automatically based on work size. Your default daily-driver.
---

# /cmax — default daily-driver

The umbrella. You hand it a goal, it produces results.

## Pipeline (default behavior, no flags)

1. **Taste check** — read `taste.md` + `taste.vision` if present. If absent and the repo has signal, suggest `cmax taste init`. Don't violate taste.
2. **/deepresearch** — web-current research with source ledger. Persisted to `memory.research_sources`.
3. **multispec decompose** — Opus authors a MultiSpec: N sub-Specs (each with measurable completion conditions + verifyHints) + DAG + rollup completion conditions + per-sub-Spec writeSet.
4. **/specqa** (parallel per sub-Spec) — gate spec quality.
5. **/introspect** (parallel per sub-Spec) — confidence/assumption check. Block at confidence < 6.
6. **Mode selection** — engine picks Mode A (SDK subagents in one query()) or Mode B (Claude Code Agent Teams) based on sub-Spec count, est. duration, cross-spec coordination, write-set overlap. Override with `--mode {auto|solo|teams}`.
7. **Parallel /goal per DAG leaf** — every leaf at the current frontier runs in parallel up to the hardware + credit-aware cap. Sonnet executes sub-Specs by default; Opus on router escalations.
8. **per-sub-Spec /verify** (parallel) — blind Opus re-reads repo, re-checks each completion condition.
9. **rollup /verify** — blind Opus checks the rollupCompletionConditions across all sub-Spec outputs.
10. **Memory record** — run snapshot to `memory.runs` + state to `.claudemax/state/`.

## Variants

| Skill | Routing |
|---|---|
| `/cmax` | Default — Opus plan + Sonnet exec + Opus verify |
| `/workflow` | Alias for /cmax (v1 muscle memory) |
| `/opussonnet` | Same as /cmax — your v1 muscle-memory name |
| `/opusolo` | Opus exec for sub-Specs too (max effectiveness, ~3× cost) |

## Hard rules

- Never declare success on the strength of the executor's own claim. The blind /verify is the source of truth.
- Verify and spec always run on Opus, never demoted regardless of credit % or `--cheap`.
- If /verify returns partial or failed, iterate /goal against the failing conditions; re-verify. If two iterations don't move it, the SPEC is probably wrong — re-spec, don't re-grind.
- Cost-guard kicks in at 70% of monthly Agent SDK credit (demote non-essential Opus → Sonnet); at 90% aggressive demote; at 95% `--force` required.

## When NOT to invoke /cmax

- Trivial one-line changes — just edit.
- A single SPEC that fits in one /goal loop — invoke `/goal` directly on the existing SPEC.md.
- Pure research with no implementation — invoke `/deepresearch` directly.
