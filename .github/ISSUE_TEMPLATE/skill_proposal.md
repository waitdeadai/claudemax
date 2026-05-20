---
name: Skill proposal
about: Propose adding a new skill to the lean 29-active-skill catalog
title: 'skill: '
labels: skill-proposal
---

> claudemax intentionally maintains a lean 29-active-skill catalog audited for overlap. Adding skills requires justification AND should survive a `/harness-audit` run against the existing 29.
> Please read [`docs/SKILL_CATALOG.md`](../../docs/SKILL_CATALOG.md) first.

## Proposed skill

**Name:** `/your-skill-name`

**One-line description:**

**Category** (pick one): Umbrella / Research / Planning / Execution / Verification / Memory & state / Taste / Infrastructure

## What it does

<!-- 3–5 sentences. Process, inputs, outputs. -->

## Distinct from (mandatory)

For each existing skill in the same category, explain how your proposal differs:

- `/<existing-skill>` — distinct because ...
- `/<existing-skill>` — distinct because ...

## Why it earns a daily-driver slot

- How often will a power user invoke this?
- What workflow becomes possible / dramatically faster with it?
- Could this be expressed as a flag on an existing skill instead?

## Implementation sketch

- Runtime module(s) needed:
- CLI command (if any):
- Tier (Opus / Sonnet / Haiku):
- Tools required:
- Estimated complexity:

## Anti-pattern check

- [ ] This is NOT a thin model-routing variant of an existing umbrella
- [ ] This is NOT a wrapper for a tool that already exists outside claudemax
- [ ] This does NOT duplicate functionality in any existing skill
