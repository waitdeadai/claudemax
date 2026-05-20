---
name: codesearch
description: Multi-pattern search with relevance ranking. Sharper than raw Grep/Glob for "find me places that look like X". Haiku tier. Returns ranked hits with context windows.
---

# /codesearch — ranked semantic-ish code search

For "find me places that look like X" queries. Smarter than a single grep.

## How it differs from raw Grep/Glob

- Multi-pattern OR/AND combinations with relevance ranking.
- Context window expansion (returns surrounding 5 lines, not just the match line).
- Heuristic re-ranking by file recency, file path centrality (e.g., `src/` ranks above `vendor/`), and exact-word vs partial-word matches.
- Deduplicates near-identical hits in the same function.

## When to use

- "Where is the auth middleware applied?"
- "All places that call `fetch` without a timeout."
- "Modules that depend on the old user model."

## When NOT to use

- Pure file globs → use Glob.
- Single-pattern grep → use Grep directly.
- Open-ended exploration → use `/audit` or `/deepresearch`.

Haiku tier (cheap; high throughput).
