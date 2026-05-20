---
name: parallel
description: Distinct-packet fan-out. Each packet does a different thing; the engine runs them concurrently up to the hardware + credit-aware cap. Use when work decomposes into independent tasks. Distinct from /hive (same problem N times) and /council (3-Opus debate).
---

# /parallel — distinct-packet fan-out

Run N different tasks concurrently up to the parallelism cap.

## Mechanics

- Packets declared as a DispatchPlan: each packet has its own objective, inputs, outputs, dependencies.
- Engine groups packets by `parallelGroups` and fans out within a group.
- Hardware cap: 3 (≤4 cores), 6 (8-15 cores), 10 (≥16 cores).
- Credit-aware cap: floor((remaining monthly credit / per-packet estimate) × 0.3). Prevents fanning out 10 Opus workers and burning 80% of your monthly Max credit on one run.
- Effective cap = min(hardware, credit-aware, --max-parallel override).

## Distinct from

- **/hive** — same problem given to N agents in parallel; merge proposals. Parallel does N different things.
- **/council** — 3-Opus adversarial debate with roles (proposer/critic/judge). Parallel has no roles.
- **multispec engine** — auto-decomposes a root goal into sub-Specs (each becomes a /goal loop). Parallel takes pre-decomposed packets.

## When NOT to use

- Single packet → just run it; parallel of one is overhead.
- Packets that touch the same file → engine serializes them; you don't gain anything by listing them as parallel.
- Long-horizon autonomous work → that's /goal per sub-Spec, not /parallel packets.

## CLI

`cmax dispatch <plan.json>` — the low-level surface. Most users hit /parallel through the multispec engine, not directly.
