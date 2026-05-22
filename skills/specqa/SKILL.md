---
name: specqa
description: Spec quality gate. Every completion condition must have a mechanically-checkable verifyHint (file path, command, test name, behavior). Blocks /goal handoff if the spec wouldn't be verifiable.
allowed-tools: Read Grep Glob Bash
---

# /specqa — spec quality gate

The cheapest place to catch a bad spec. A bad spec produces a wrong /goal run that /verify correctly fails — you re-do everything. /specqa prevents that by gating spec quality before /goal handoff.

## Checks

For each completion condition:
- Does it have a verifyHint?
- Is the verifyHint mechanically checkable? (file path exists, command runs, test name resolves, behavior is observable)
- Does it overlap with another completion condition? (redundancy is a smell)
- Is it bounded? (no "etc", no open-ended quantifiers)

For the spec as a whole:
- nonGoals listed (at least one).
- constraints listed if non-trivial.
- evidenceRequired enumerated.

## Output

```
verdict: pass | fail
score: 0-100
issues:
  - condition <id>: <issue>
  - spec: <structural issue>
```

## Gate behavior

- **fail** → blocks /goal handoff. Engine asks the spec writer to revise.
- **pass with score < 80** → proceeds but logs a warning into memory.episodes.
- **pass with score ≥ 80** → proceeds silently.

## When invoked

Auto-invoked by every umbrella between /spec and /introspect. Manually invoke when you want to audit a hand-written SPEC.md.
