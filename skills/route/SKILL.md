---
name: route
description: Show the model-routing decision for a task (Opus/Sonnet/Haiku) with reasoning. Use before launching a packet to sanity-check the tier and to override when you have stronger judgment than the heuristic.
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

## Demotion triggers (Opus → Sonnet)

- `--cheap` / forceCheap mode AND class is not `verify` or `spec`
- cost ceiling exceeded AND Sonnet estimate fits AND class is not `verify` or `spec`

## Never demote

`verify` and `spec` always run on Opus. They are the supervisor and the contract — cheap them and the whole harness loses its teeth.

## Output

Tier, model id, tools, maxTurns, estimated cost USD, escalation flag, reasoning. Pure read-only — no side effects.
