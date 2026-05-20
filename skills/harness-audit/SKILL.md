---
name: harness-audit
description: Periodic review of claudemax's own scaffolding against the current Opus capability. Flags load-bearing vs vestigial pieces so the harness stays sharp as models improve. Run after every major model release or quarterly, whichever comes first.
---

# /harness-audit — keep the scaffolding sharp

Models improve. Yesterday's helpful scaffolding becomes today's friction. This skill audits claudemax against the current model and surfaces what should be deleted, simplified, or kept.

## What it checks

1. **Skill catalog overlap** — re-runs the overlap audit against `docs/SKILL_CATALOG.md`. Flags any skill whose purpose now overlaps another (e.g., a primitive the umbrella has subsumed).
2. **Prompt verbosity** — sample the system prompts in `packages/runtime/src/prompts.ts`. Flag any prompt > 1500 chars whose every clause is not load-bearing for the current Opus baseline.
3. **Router rules** — re-evaluate `packages/core/src/router.ts` heuristics against the current Opus default capabilities. Flag rules that no longer change behavior on the current model.
4. **Dark-patterns hook coverage** — audit `.claude/hooks/` invocation against current-model failure modes. Flag hooks that haven't fired in N runs and modes that have started slipping through.
5. **Cost-guard thresholds** — re-evaluate 70 / 90 / 95 % thresholds against actual run-cost distribution from `memory.runs`.
6. **Skill description currency** — every SKILL.md `description:` should still reflect what the skill actually does. Flag drift.

## Output

A `HARNESS_AUDIT.md` artifact in the repo root with sections:

```
## load-bearing (keep)
- <item> — <one-line reason it's still earning its place>

## redundant (delete or merge)
- <item> — <what overlaps it, why deletion is safe>

## simplify
- <item> — <what to cut from it without losing the load-bearing piece>

## measurement gaps
- <thing we cannot decide without data> — <what to instrument>
```

The output is human-reviewed; this skill does NOT auto-delete anything.

## When to run

- After every major Anthropic model release (`/harness-audit --against opus-X.Y`).
- Quarterly as hygiene.
- When `cmax doctor` flags credit consumption climbing without proportional effectiveness gain.
- Before any /skill addition: gate the new skill on whether it survives an audit against the existing catalog.

## What it does NOT do

- Does not edit any skill, prompt, router rule, or hook. Output is recommendations only.
- Does not benchmark — separate concern (see `docs/SOTA_2026.md`).
- Does not propose new scaffolding. Its job is subtraction, not addition.

## Why this is load-bearing

The Anthropic harness-design guide explicitly recommends: "strip away pieces that are no longer load-bearing to performance" as models improve. A harness that only grows is a harness that gets in its own way. `/harness-audit` is the codification of that subtraction discipline.
