---
name: Feature request
about: Propose a new capability or change in claudemax
title: 'feat: '
labels: enhancement
---

## Problem

<!-- What workflow are you trying to do that claudemax doesn't support well today? Concrete example > abstract description. -->

## Proposed shape

<!-- What would the CLI / skill / API look like? Describe the user-visible behavior. -->

## Why this fits claudemax

Check ALL that apply. If none apply, the feature probably doesn't fit:

- [ ] Improves effectiveness of the multispec pipeline (`deepresearch → multispec → /goal → /verify`)
- [ ] Adds value for Claude Max subscribers (Max 5x or Max 20x)
- [ ] Improves the remote-from-phone / "main mode while away" flow
- [ ] Addresses a 2026 SOTA pattern claudemax is missing
- [ ] Fixes an honest gap in the parallelism / verification / billing surface

## Overlap audit (mandatory)

Per `docs/SKILL_CATALOG.md`, claudemax is intentionally a lean 29-active-skill catalog (plus 1 deprecated stub). If your proposal adds a skill or CLI command:

- Which existing skill / command is most similar?
- Why is your proposal distinct enough to warrant a new entry rather than an extension?

## Out of scope (please confirm)

- [ ] This is not asking for multi-provider support (claudemax is Anthropic-only by design)
- [ ] This is not asking to lower `/verify`, `/spec`, or `/architect` from Opus baseline
- [ ] This is not asking to change the multispec-default behavior
- [ ] This is not asking for a GUI / IDE plugin
