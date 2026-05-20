---
name: spec
description: Write SPEC.md with measurable completion conditions before any code runs. Use Opus. Triggered automatically by /cmax. Run it standalone when you want a contract for a goal before committing to execution.
---

# /spec — SPEC.md writer

Convert a goal into a written contract. **No completion condition without a verifyHint.**

## Required sections

- **Goal** — what success looks like in one paragraph
- **Completion conditions** — each one has an `id`, a `description`, and a `verifyHint` (a file path, a command, a passing test, a visible behavior)
- **Non-goals** — at least one; explicitly out of scope
- **Constraints** — invariants (must not break X, must run on Y)
- **Assumptions** — things treated as given; a verifier will double-check
- **Evidence required** — artifacts you'll produce as proof (tests, diffs, logs)

## Anti-patterns

- "It works" is not a completion condition. Specify how a blind reviewer would confirm it.
- "Refactor for clarity" without a behavior-preserving check is unverifiable. Demand a passing test suite.
- "Add tests" with no coverage delta or named test is hand-wavy. Name the tests or the files.

## Output

Write `SPEC.md` at the project root. Tier: **Opus**. Tool: `Write`.
