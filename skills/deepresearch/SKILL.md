---
name: deepresearch
description: Iterative web-current research with source ledger. Sonnet collects, Opus synthesizes. Parallel WebSearch + WebFetch across sub-queries. Output is a structured ResearchBrief with citations, persisted to memory.research_sources. The default first step of every umbrella when the goal is novel or time-sensitive.
---

# /deepresearch — sourced research with ledger

The research substrate for every umbrella. Anchors decisions on current-time evidence, not training-cutoff knowledge.

## Process

1. **Memory-first ledger lookup.** Before any web call, query `memory.research_sources` for the topic within the last 7 days (default window). If a fresh prior brief exists, reuse it and skip steps 2–5. Outside the window, surface the prior brief as "possibly stale" alongside a fresh pass so the caller can compare. Disable the shortcut with `memoryFirst: false` (or `--no-memory-first` on the CLI) when the topic is known-volatile and must re-fetch every run.
2. Decompose the topic into 3–8 sub-queries.
3. Run WebSearch + WebFetch in parallel across the sub-queries.
4. Read primary sources first (official docs, vendor announcements, RFCs, repos). De-prioritize SEO blogspam.
5. Resolve conflicts by citing the most recent authoritative source.
6. Synthesize via Opus into a ResearchBrief: topic, summary, keyFindings, sources (URL + relevance + excerpt + accessedAt), openQuestions.
7. Persist sources to `memory.research_sources` for future re-use.

## When to invoke (manually)

- Before architectural decisions where SOTA matters (`/cmax` and friends already invoke this automatically).
- When evaluating libraries, models, or services as of today.
- When the goal involves a regulation, pricing, or API that changes frequently.

## Output

JSON `ResearchBrief` matching the schema in `packages/core/src/types.ts`. CLI: `cmax research "<topic>"` prints the brief and writes sources to memory.

## Anti-pattern protection

- **Citation linkage is schema-enforced.** Every `keyFinding` now carries ≥ 1 `sourceUrl` drawn from the brief's `sources` array — the JSON schema rejects findings without one. Uncitable findings are dropped at generation time rather than emitted naked; the dark-patterns `no-fake-cite` hook is the second line of defense, not the first.
- Every claim attaches ≥ 1 source URL with an `accessedAt` field.
- Sources with relevance < 0.3 are dropped.
- `openQuestions` is mandatory — research that returns "everything is clear" is suspicious.
