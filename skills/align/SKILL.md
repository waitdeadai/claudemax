---
name: align
description: One-shot semantic decision recorder. Writes topic + decision + rationale to memory.decisions for future sessions to recall. Tiny skill; load-bearing for cross-session continuity.
---

# /align — record a semantic decision

When you make a non-obvious architectural choice or pin a convention, run /align so future sessions know the decision was deliberate.

## Inputs

- `topic` — short slug (e.g., "session-tokens", "deps-policy")
- `decision` — what was decided
- `rationale` — why; ideally cites evidence

## Output

Writes to `memory.decisions` (SQLite). Indexed by topic. Searchable via /memory.

## When to use

- After a /council judgment.
- After picking between two viable approaches when the "why" matters.
- When deferring a future decision (record what was deferred and the trigger that should re-open it).

## When NOT to use

- Trivial choices — taste.md is the better home for rules-of-thumb.
- Things that the code itself documents (the diff is the source of truth).
