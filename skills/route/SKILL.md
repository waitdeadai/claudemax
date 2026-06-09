---
name: route
description: Show the model-routing decision for a task (Fable/Opus/Sonnet/Haiku) with reasoning. Use before launching a packet to sanity-check the tier and to override when you have stronger judgment than the heuristic.
---

# /route — model routing decision

Surface the routing decision so the human (or the orchestrator) can confirm or override.

## Default table

| Class               | Tier   | Reason                                          |
|---------------------|--------|-------------------------------------------------|
| plan, architect, spec | Opus | reasoning + spec authorship                     |
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

## Escalation triggers (Opus → Fable 5)

Fable 5 (`claude-fable-5`, launched 2026-06-09, 2× Opus price) is escalation-only — never a baseline:

- `--long-horizon` on `plan` / `debug-hard` — work larger than a single sitting (overnight runs, multi-day converge loops, ambiguous root-cause hunts)
- explicit `--tier fable`
- NEVER for security domains (Fable's safety classifiers fall back to Opus anyway; headless requests get refusals) and NEVER for `verify`/`spec`/`architect` (pinned to Opus)
- after 2026-06-22 Fable bills to usage credits on Max — the route reason flags this

## Demotion triggers (Fable/Opus → cheaper)

- `--cheap` / forceCheap mode AND class is not `verify` or `spec` → Sonnet
- plan-budget guard demotes one rung (fable→opus, opus→sonnet); danger/blocked → Sonnet
- cost ceiling exceeded AND a cheaper tier fits AND class is not `verify` or `spec` (fable tries opus first, then sonnet)

## Never demote

`verify` and `spec` always run on Opus. They are the supervisor and the contract — cheap them and the whole harness loses its teeth.

## Output

Tier, model id, tools, maxTurns, estimated cost USD, escalation flag, reasoning. Pure read-only — no side effects.
