# Workflow variants

Four umbrellas. All four auto-run the same full pipeline (deepresearch + multispec + parallel /goal + verify + rollup verify). They differ only in **sub-Spec /goal exec tier**.

| Skill | Plan/judge | Sub-Spec /goal exec | Verify | When |
|---|---|---|---|---|
| `/cmax` | Opus | **Sonnet** | Opus | Default daily-driver |
| `/workflow` | Opus | Sonnet | Opus | Alias for /cmax (v1 muscle memory) |
| `/opussonnet` | Opus | Sonnet | Opus | v1 muscle memory; same as /cmax |
| `/opusolo` | Opus | **Opus** | Opus | Max-effectiveness; ~3× cost |

## Why only four

v1 had 6 core execution variants (/workflow, /opusworkflow, /opusminimax, /sonnetminimax, /opussonnet, /opusolo) plus /hiveworkflow. v2 cut to 4:

- `/opusminimax` + `/sonnetminimax` → dropped (MiniMax-specific).
- `/opusworkflow` → identical to `/opussonnet` in v2 (MiniMax slot → Sonnet); kept under /opussonnet name.
- `/hiveworkflow` → use `/opussonnet --mode teams` for swarm behavior (Mode B).
- `/sonnetonly` → not requested; can be `--variant sonnet` if ever needed.

## Picking between /cmax (= /opussonnet) and /opusolo

| Signal | Use /opussonnet | Use /opusolo |
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
