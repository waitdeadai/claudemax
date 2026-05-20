---
name: verify
description: Independent Opus supervisor pass that re-reads the repo blind and re-checks every SPEC completion condition. The source of truth for whether a run actually succeeded. Never skip.
---

# /verify — independent verification

A second, blind Opus session reads the repo and checks each completion condition against its verifyHint. The verifier did not do the implementation — that's the point. It looks for evidence, not narration.

## Verdicts

- **verified** — every completion condition met with first-hand evidence (a file exists, a test passes, a behavior holds).
- **partial** — some met, some not. The notes field names which.
- **failed** — none met, or implementation claimed success but the repo doesn't show it.

## What the verifier does

- Reads files referenced by verifyHints.
- Runs tests if the verifyHint names a test.
- Greps for symbols, types, exports if the verifyHint names them.
- Inspects generated artifacts (logs, screenshots, diffs).
- Does NOT trust prior agents' claims.

## When verify says failed

- Iterate `/goal` with the failure notes as additional input.
- If iteration loops twice without progress, escalate to a human review. Don't paper over.

## Output

JSON object with `perCondition` array, `verdict`, and `notes`.
