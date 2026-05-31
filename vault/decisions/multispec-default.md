---
kind: decision
slug: multispec-default
title: Multispec is the default — every umbrella auto-runs the full pipeline
decision: Multispec is the default. Every umbrella (/cmax, /opusolo, /opussonnet, /ask) auto-runs deepresearch + multispec decomposition + parallel /goal + verify. There is NO `--multi` flag. Single-spec mode exists only as an internal engine optimization, never as a user-facing toggle.
rationale: The north star is effective completion of software work via deepresearch + multispec + /goal + verify. Making the full pipeline the default (not an opt-in) means the user describes a goal and the SOTA-2026 pipeline handles the rest — that is the flagship behavior. A `--multi` flag would make the harness's core value proposition optional and dilute the "fat umbrella" design.
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-05-31
ttl_days: 365
tags: [multispec, pipeline, umbrellas, hard-rule]
source: CLAUDE.md
---

## Decision

Multispec is the default. Every umbrella auto-runs deepresearch + multispec +
parallel /goal + verify. No `--multi` flag. Single-spec mode is an internal engine
optimization only.

## Rationale

The fat umbrellas are not thin model variants — they each run the full pipeline.
The user states a goal; deepresearch (when novel/time-sensitive) feeds multispec
decomposition, which fans out into parallel /goal leaves, gated by a blind Opus
verify. Two parallelism modes (A: SDK subagents; B: Agent Teams) are auto-selected
by work size. Making any of this opt-in would betray the north star.

## Alternatives rejected

- A `--multi` flag gating multispec — rejected; the pipeline is the default, not a mode.
- Umbrellas as thin model selectors — rejected; they auto-run the whole pipeline.

## Consequences

- Working rule 5 in CLAUDE.md enforces this; the multispec engine is the flagship.
- Single-spec is chosen internally for small/non-decomposable work, never via a user flag.
