---
name: review
description: Reviews a proposed diff for correctness, security, style, taste alignment. Distinct from /audit (which reviews existing code, not diffs) and /verify (which checks SPEC completion).
---

# /review — diff review

Pre-merge sanity on a proposed change.

## Scope

A specific diff: file paths + line ranges, or a git diff stdin.

## Checks

- Correctness: does the diff actually do what the commit message says?
- Security: any new attack surface? input validation? auth bypass?
- Style: aligned with taste.md? naming conventions? error handling patterns?
- Tests: does the diff add/update tests for the new behavior?
- Side effects: does the diff change something the diff message doesn't mention?

## Output

```
verdict: approve | request-changes | reject
issues:
  - critical: <issue>  (must-fix before merge)
  - major: <issue>     (should-fix)
  - nit: <issue>       (taste suggestion)
```

## Distinct from

- **/audit** — scans existing code (no diff). /review needs a diff.
- **/verify** — checks SPEC completion conditions. /review checks the diff quality independent of a spec.
- **/ship** — final go/no-go combining /verify + /review.
