---
name: deepretaste
description: Drift detection. Re-runs /taste against current code and reports what changed between the recorded taste.vision and the repo's current state. Use periodically (monthly?) or after large refactors.
---

# /deepretaste — taste drift detection

Same engine as /taste, but its job is to surface drift.

## Process

1. Read current `taste.md` + `taste.vision`.
2. Re-run /taste's deepresearch + repo-signal pass.
3. Diff the regenerated taste against the recorded one.
4. Report: what's drifted, what's still aligned, what new SOTA findings invalidate prior choices.

## When to use

- Monthly cadence (or after a major version bump).
- After a large refactor where the codebase changed shape.
- When you suspect taste.md is stale (e.g., you added a database but taste.vision still says "no persistent state").

## Output

```
drift_summary: <one paragraph>
drifted_principles:
  - <principle> — was: <old>; now: <new>; cause: <evidence>
new_findings:
  - <SOTA change that invalidates prior assumption>
recommendation: regenerate | patch | no-action
```

## CLI

`cmax taste drift` — runs /deepretaste and prints the report. Does NOT auto-rewrite taste.md unless `--apply` is passed.
