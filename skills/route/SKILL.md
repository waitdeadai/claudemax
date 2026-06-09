---
name: route
description: Show the model-routing decision for a task (Fable/Opus/Sonnet/Haiku) with reasoning. Use before launching a packet to sanity-check the tier and to override when you have stronger judgment than the heuristic.
---

# /route — model routing decision

Surface the routing decision so the human (or the orchestrator) can confirm or override.

## Default table

| Class               | Tier   | Reason                                          |
|---------------------|--------|-------------------------------------------------|
| plan                | Fable 5 while included (→2026-06-22), else Opus | decomposition quality propagates downstream |
| architect, spec     | Opus   | reasoning + spec authorship (pinned)            |
| verify, audit       | Opus   | independent skepticism                          |
| debug-hard          | Opus   | subtle, multi-cause                             |
| implement, refactor, test | Sonnet | routine coding, fast and capable           |
| search, summarize, classify, route | Haiku | cheap throughput                  |

## Escalation triggers (Sonnet → Opus)

- complexity ≥ 7
- novelty ≥ 8 (no prior memory match)
- prior failure on similar packet
- security/auth/payments/secrets domain
- explicit `--tier opus` or `--opus` user signal

## Fable 5 routing (access-gated, auto-switch 2026-06-23)

Fable 5 (`claude-fable-5`, launched 2026-06-09, 2× Opus price) runs in two configurations via `resolveFableAccess()` (`CMAX_FABLE_ACCESS=included|credits` overrides):

- **included** (now → 2026-06-22, free on Max): `plan` baselines to Fable; multispec decompose runs on Fable; `--long-horizon` escalates `plan`/`debug-hard` (overnight runs, multi-day converge loops, ambiguous root-cause hunts)
- **credits** (2026-06-23 →, bills usage credits): all Fable defaults auto-demote to Opus; only explicit `--tier fable` / `cmax loop run --fable` reaches Fable
- in BOTH: NEVER for security domains (clamps to Opus — Fable's safety classifiers fall back there anyway; headless requests end the turn) and NEVER for `verify`/`spec`/`architect` (pinned to Opus)

## Demotion triggers (Fable/Opus → cheaper)

- `--cheap` / forceCheap mode AND class is not `verify` or `spec` → Sonnet
- plan-budget guard demotes one rung (fable→opus, opus→sonnet); danger/blocked → Sonnet
- cost ceiling exceeded AND a cheaper tier fits AND class is not `verify` or `spec` (fable tries opus first, then sonnet)

## Never demote

`verify` and `spec` always run on Opus. They are the supervisor and the contract — cheap them and the whole harness loses its teeth.

## Output

Tier, model id, tools, maxTurns, estimated cost USD, escalation flag, reasoning. Pure read-only — no side effects.
