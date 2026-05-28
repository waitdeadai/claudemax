# Execution variants

> Naming note: this is about the cmax **`--variant`** model-routing tiers, NOT Claude Code's native **Workflow tool** (the multi-subagent orchestration primitive triggered by the word "workflow"). The `/workflow` umbrella alias was removed 2026-05-28 precisely to avoid that collision.

Two umbrellas auto-run the same full pipeline (deepresearch + multispec + parallel /goal + verify + rollup verify). They differ only in **sub-Spec /goal exec tier**, also selectable directly via `cmax run --variant {opussonnet|opusolo}`.

| Umbrella / variant | Plan/judge | Sub-Spec /goal exec | Verify | When |
|---|---|---|---|---|
| `/cmax` (`--variant opussonnet`, default) | Opus | **Sonnet** | Opus | Default daily-driver (`/ask` = same engine) |
| `/opusolo` (`--variant opusolo`) | Opus | **Opus** | Opus | Max-effectiveness; ~3× cost |

## Why so few

v1 had 6 core execution variants (/workflow, /opusworkflow, /opusminimax, /sonnetminimax, /opussonnet, /opusolo) plus /hiveworkflow. v2 collapsed these to two exec tiers (`opussonnet`, `opusolo`) reachable via two umbrellas (`/cmax`, `/opusolo`):

- `/opusminimax` + `/sonnetminimax` → dropped (MiniMax-specific).
- `/opusworkflow` → folded into the `opussonnet` tier (MiniMax slot → Sonnet).
- `/workflow` + `/opussonnet` umbrella **aliases** → removed 2026-05-28 (duplicated `/cmax`; `/workflow` collided with the native Workflow tool). The `opussonnet` exec tier lives on as `--variant opussonnet`.
- `/hiveworkflow` → use `--variant opussonnet --mode teams` for swarm behavior (Mode B).
- `/sonnetonly` → not requested; can be `--variant sonnet` if ever needed.

## Picking between /cmax (default) and /opusolo

| Signal | Use /cmax (opussonnet) | Use /opusolo |
|---|---|---|
| Routine refactor / feature / bug fix | ✓ | — |
| Auth / payments / billing / crypto / secrets | — | ✓ (security domain — router would escalate anyway) |
| Novel domain (no prior pattern in memory) | — | ✓ |
| Hard debug across many files where Sonnet has been spinning | — | ✓ |
| Architectural change affecting contracts you don't want to revisit | — | ✓ |
| You're past 70% of monthly Max credit | ✓ (cost-guard will demote anyway) | (cost-guard kicks in) |
| You want predictable cost shape | ✓ | (3× more variable) |

## Cost shape (typical multispec run, 6 sub-Specs)

| Variant | Sonnet exec | Opus exec | Total credit (Max5x/Max20x %) |
|---|---|---|---|
| /opussonnet | 6 sub-Specs | 0 | ~$3–6 (3–6% / 1.5–3%) |
| /opusolo | 0 | 6 sub-Specs | ~$10–18 (10–18% / 5–9%) |

On Max 20x ($200/mo), /opusolo runs ~12–20 multispec passes/month before cost-guard demotes. On Max 5x ($100/mo), ~5–10 /opusolo runs/month.

## Mode (parallel mode) is orthogonal to variant

`--variant {opussonnet|opusolo}` picks the exec tier.
`--mode {auto|solo|teams}` picks parallelism shape.

You can combine: `cmax run "<task>" --variant opusolo --mode teams` runs an all-Opus swarm via Claude Code Agent Teams. The most expensive and most powerful combination.
