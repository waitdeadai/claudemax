---
name: ship
description: Final go/no-go gate combining /verify (against SPEC) + /review (of the diff). Does NOT commit unless user explicitly authorizes. The last check before merge.
---

# /ship — final go/no-go

The last gate before merge. Combines /verify (SPEC met?) + /review (diff quality?) into one go/no-go decision.

## Process

1. Run /verify against the SPEC (blind Opus, re-reads repo, runs verifyHints).
2. Run /review against the diff (correctness, security, style, taste).
3. Combine into a single verdict.

## Output

```
verdict: ship | hold | block
verify_result: verified | partial | failed
review_result: approve | request-changes | reject
blockers:
  - <thing that must be fixed before ship>
recommendations:
  - <thing that should be fixed but isn't blocking>
```

## Hard rules

- Does NOT commit unless the user explicitly authorizes via `cmax ship --commit` or follow-up confirmation.
- `verify_result === failed` → automatic block.
- `review_result === reject` → automatic block.
- `verify === partial` AND `review === approve` → hold (proceeds only on user confirm).
