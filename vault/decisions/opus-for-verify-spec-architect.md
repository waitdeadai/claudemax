---
kind: decision
slug: opus-for-verify-spec-architect
title: /verify, /spec, /architect always run on Opus — never demoted
decision: /verify, /spec, and /architect ALWAYS run on Opus. They are never demoted to Sonnet or Haiku, even with `--cheap` and even past the 70/90/95% monthly Agent SDK credit cost-guard thresholds. The plan-aware cost-guard demotes non-essential Opus, but these three judgment surfaces are exempt.
rationale: These three are the harness's judgment and contract surfaces — specification quality, architecture decisions, and the independent blind verification pass that is the source of truth for whether a run succeeded. Demoting them to save credit would corrupt the very signal the harness exists to produce. Effectiveness, not efficiency, is claudemax's angle; the verify/spec/architect tier is where that principle is non-negotiable.
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-05-31
ttl_days: 365
tags: [routing, opus, cost-guard, hard-rule]
source: CLAUDE.md
---

## Decision

`/verify`, `/spec`, and `/architect` always run on Opus and are never demoted —
not with `--cheap`, not past the 70/90/95% cost-guard thresholds.

## Rationale

`/verify` is the independent Opus supervisor pass that re-reads the repo blind and
re-checks every completion condition — it is the source of truth for success.
`/spec` writes the measurable completion contract. `/architect` makes irreversible
structural decisions. Trading model quality for credit on any of these would
undermine the harness's whole reason to exist (effectiveness over efficiency).

## Alternatives rejected

- Allowing `--cheap` to demote these to Sonnet — rejected; corrupts the judgment signal.
- Letting the 95% blocked threshold force a Haiku fallback — rejected; `--force` is
  for the run, never for downgrading these three tiers.

## Consequences

- Router defaults for these three are sacred (working rule 3 + rule 4 in CLAUDE.md).
- The cost-guard's demote logic must exempt verify/spec/architect at every threshold.
