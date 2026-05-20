---
name: investigate
description: Multi-source root-cause analysis for a specific bug or failure. Depth-first on one symptom. Use when something is broken and you need the actual cause, not a workaround.
---

# /investigate — root-cause analysis

Depth-first on one symptom. The investigator's job is to find the actual cause, not patch the symptom.

## Process

1. Reproduce the symptom (run the failing test, hit the failing endpoint, replay the failing input). If you can't reproduce, that's the first finding.
2. Inventory all code paths that touch the symptom.
3. Bisect via git, logs, or feature flags to localize the regression.
4. Hypothesize a cause; design a minimal test that would prove or disprove the hypothesis; run it.
5. Iterate until the hypothesis holds and the proof is mechanical.
6. Output: cause statement + evidence path + suggested fix shape (do NOT auto-apply; pass to /goal or /opussonnet for execution).

## When to use

- A specific test is failing or flaky.
- A specific endpoint or page is broken.
- A specific user-reported bug needs a definitive cause.

## Distinct from

- `/audit` — breadth-first across many holes. Investigate is depth-first on one.
- `/debug-hard` task class — the router escalates debug-hard to Opus automatically; /investigate is the user-invokable skill.
