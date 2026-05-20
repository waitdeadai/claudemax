---
name: deepresearch
description: Iterative web-current research with source ledger. Sonnet collects, Opus synthesizes. Parallel WebSearch + WebFetch across sub-queries. Output is a structured ResearchBrief with citations, persisted to memory.research_sources. The default first step of every umbrella when the goal is novel or time-sensitive.
---

# /deepresearch — sourced research with ledger

The research substrate for every umbrella. Anchors decisions on current-time evidence, not training-cutoff knowledge.

## Process

1. Decompose the topic into 3–8 sub-queries.
2. Run WebSearch + WebFetch in parallel across the sub-queries.
3. Read primary sources first (official docs, vendor announcements, RFCs, repos). De-prioritize SEO blogspam.
4. Resolve conflicts by citing the most recent authoritative source.
5. Synthesize via Opus into a ResearchBrief: topic, summary, keyFindings, sources (URL + relevance + excerpt + accessedAt), openQuestions.
6. Persist sources to `memory.research_sources` for future re-use.

## When to invoke (manually)

- Before architectural decisions where SOTA matters (`/cmax` and friends already invoke this automatically).
- When evaluating libraries, models, or services as of today.
- When the goal involves a regulation, pricing, or API that changes frequently.

## Output

JSON `ResearchBrief` matching the schema in `packages/core/src/types.ts`. CLI: `cmax research "<topic>"` prints the brief and writes sources to memory.

## Anti-pattern protection

- Every claim attaches ≥ 1 source URL with an `accessedAt` field. If you see a claim without a source, the dark-patterns `no-fake-cite` hook will block it.
- Sources with relevance < 0.3 are dropped.
- `openQuestions` is mandatory — research that returns "everything is clear" is suspicious.
