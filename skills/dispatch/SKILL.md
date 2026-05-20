---
name: dispatch
description: DEPRECATED as a skill — use `cmax dispatch <plan.json>` CLI instead, or `/parallel` for the user-facing skill. v0.2 audit removed /dispatch from the lean catalog because /parallel covers the same surface at the skill layer.
---

# /dispatch — DEPRECATED

This skill exists for v0.1 muscle memory. In v0.2 the lean catalog audit moved dispatch to CLI-only:

- For the user-facing skill: use **/parallel** (same surface, clearer name).
- For programmatic packet fan-out: use **`cmax dispatch <plan.json>`** CLI.

See `skills/parallel/SKILL.md` and `cmax dispatch --help`.
