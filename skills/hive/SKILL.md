---
name: hive
description: Same problem given to N agents in parallel; merge proposals. Use when you want N independent attempts at the same goal and a synthesized merge. Distinct from /parallel (N different things) and /council (adversarial debate with roles).
---

# /hive — parallel proposals + merge

N independent agents draft a proposal for the same problem; a merger synthesizes them into one superior answer.

## When to use

- A high-stakes architectural choice where you want diverse drafts before committing.
- A creative or open-ended question where the first answer is rarely the best.
- When you suspect any single model run has variance you want to average over.

## How it differs

- **/parallel** runs N different tasks (DispatchPlan). /hive runs the SAME problem N times.
- **/council** has explicit roles (proposer/critic/judge). /hive has no roles — N independent drafters and one merger.

## Defaults

- 3 proposers (Opus tier).
- 1 merger (Opus tier).
- All proposers run in parallel; merger runs after fan-in.

## Cost

~4× /opussonnet for the same problem (3 proposers + 1 merger). Worth it for irreversible decisions; overkill for routine work.
