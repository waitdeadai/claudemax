---
name: introspect
description: Confidence/assumption hard-gate before /goal handoff. Outputs confidence 0-10, assumptions, unknowns. **Blocks /goal if confidence < 6.** Cheap (Opus, ~5 turns); catches false-confidence wrong turns.
---

# /introspect — confidence and assumption check

A hard-gate before autonomous /goal handoff. The fastest way to catch a wrong turn is to ask the model to introspect on its own plan before executing.

## Output shape

```
confidence: 0-10
assumptions:
  - <thing treated as given>
  - ...
unknowns:
  - <thing the model doesn't know>
  - ...
recommendation: proceed | clarify | research-more
```

## Gate behavior

- **confidence < 6** → blocks /goal handoff. Engine surfaces unknowns and asks for clarification OR runs /deepresearch to resolve.
- **6 ≤ confidence < 8** → proceeds with assumptions logged into memory.decisions.
- **confidence ≥ 8** → proceeds silently.

## Why it works

Opus is generally calibrated on confidence. Forcing it to enumerate assumptions and unknowns surfaces the things that would make it fail mid-/goal. Cheaper to catch them here (5 turns Opus) than mid-/goal (50+ turns).

## When invoked

Auto-invoked by every umbrella between /spec(qa) and /goal. Manually invoke when you want a confidence check before a big autonomous run.
