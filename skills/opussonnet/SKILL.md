---
name: opussonnet
description: ALIAS for /cmax — identical engine and identical routing (Opus plans/judges/verifies, Sonnet executes sub-Specs). Kept only for minmaxing v1 muscle memory. Routing model should pick /cmax (or /ask) by default; only invoke /opussonnet if the user typed the literal string `/opussonnet`.
---

# /opussonnet — Opus judgment + Sonnet execution

Your v1 main. v2 makes it the default behavior of /cmax — they're effectively the same in v2 since v1's /opusworkflow used MiniMax (dropped) and /opussonnet is the right routing for daily software work on Anthropic-only.

## Pipeline

Same FAT pipeline as every umbrella:

1. /deepresearch (sourced, web-current)
2. multispec decompose (Opus authors)
3. /specqa + /introspect gates
4. parallel /goal per DAG leaf — **Sonnet 4.6 executes; Opus would only run for verify/spec/architect or escalated tiers**
5. per-sub-Spec /verify (always Opus, blind)
6. rollup /verify (Opus, blind)
7. memory record

## When to invoke

- Default for almost all software work — refactors, features, migrations, bug fixes.
- The router auto-escalates sub-Specs to Opus when they touch security/auth/payments or have complexity ≥ 7 or novelty ≥ 8. You don't have to think about it.

## When NOT to invoke

- The work is novel-domain across the board (consider /opusolo).
- You're debugging a deeply weird production bug (consider /opusolo + /investigate).
- You want max-effectiveness regardless of cost — /opusolo.

## Cost shape on Max plans

A typical refactor (~6 sub-Specs, ~10 turns each Sonnet) costs ~$2–5 in Agent SDK credit. /opussonnet vs /opusolo: ~3× cheaper for the same scope.
