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
- **unverified** — default-FAIL state: the spec declares no conditions, or no verdict artifact was produced. Treated as not-done.

## What the verifier does

- Reads files referenced by verifyHints.
- Runs tests if the verifyHint names a test.
- Greps for symbols, types, exports if the verifyHint names them.
- Inspects generated artifacts (logs, screenshots, diffs).
- Does NOT trust prior agents' claims.

## How it verifies (decomposed + default-FAIL)

- **Decomposed** — one blind verifier per completion condition, run in parallel
  with a hard per-condition wall-clock timeout, so a hung condition fails only
  itself (not the whole batch). Legacy single-pass is `decomposed:false`.
- **Default-FAIL + evidence-required** — every declared condition starts not-met
  and flips to met ONLY with a concrete first-hand artifact (command exit code,
  file region, passing test). A condition the model omits, or "met" with empty
  evidence, is a fail; a failed interactive probe is authoritative.
- **Persisted verdict** — writes `.claudemax/state/verdict-<hash>.json` whose
  `gate.pass` is the single definition of "done" that the Stop/SubagentStop
  completion gate reads. "Done" is proven on disk, not declared.
- **Adversarial (`--adversarial`)** — stress-tests the verifier with fabricated
  claims + an isomorphic restatement; a condition it can be fooled about is
  downgraded to not-met.
- **PRC** — `prc-*` production-ready conditions are verified like any other.

## When verify says failed

- Iterate `/goal` with the failure notes as additional input.
- If iteration loops twice without progress, escalate to a human review. Don't paper over.

## Output

JSON object with `perCondition` array, `verdict`, and `notes`.
