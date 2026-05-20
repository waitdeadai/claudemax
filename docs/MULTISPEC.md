# Multispec pipeline

The flagship daily-driver. Decompose a large goal into N verifiable sub-Specs with a DAG, run them in parallel via `/goal`, verify each in isolation, then verify the rollup.

## Pipeline

```
user goal (large)
   ↓
1. /deepresearch (Sonnet collects, Opus synthesizes)         → ResearchBrief + source ledger
   ↓
2. multispec decompose (Opus authors)                         → MultiSpec: N sub-Specs + DAG + rollup conditions + writeSet per sub-Spec
   ↓
3. /specqa (parallel; one Haiku worker per sub-Spec)          → quality gate: verifyHints must be mechanically checkable
   ↓
4. /introspect (parallel; one Opus worker per sub-Spec)       → confidence ≥ 6; assumptions logged; unknowns surfaced
   ↓
5. Mode selection (Mode A or Mode B; auto-selected)
   ↓
6. For each leaf in DAG, in parallel up to maxParallel cap:
     /goal (Opus driver via Claude Code's native /goal)        → per-sub-Spec EVIDENCE + STATUS
   ↓
7. per-sub-Spec /verify (parallel; blind Opus)                 → per-condition met/not + verdict
   ↓
8. rollup /verify (blind Opus against rollupCompletionConditions)
   ↓
9. memory record + state snapshot
```

## MultiSpec type

```typescript
interface MultiSpec {
  readonly rootGoal: string;
  readonly researchBrief?: ResearchBrief;
  readonly subSpecs: readonly Spec[];                  // each fully-formed
  readonly dependencies: { from: string; to: string }[]; // DAG of sub-Spec IDs
  readonly rollupCompletionConditions: readonly SpecCompletionCondition[];
  readonly writeSetByspecId: Record<string, readonly string[]>;
  readonly mode: "auto" | "solo" | "teams";
  readonly modeReason: string;
  readonly createdAt: string;
}
```

## Why beat raw `/goal`

- **Raw /goal**: validator-loop is great per-objective, but a 50-file migration thrashes without decomposition.
- **Monolithic SPEC**: one verify run is brittle; integration failures show up only at the end with no isolation.
- **Multispec**: each sub-Spec small enough for the validator-loop to stay sharp; per-sub-Spec verify isolates failures; rollup verify catches integration regressions.

## Why beat v1's `/opusworkflow`

v1's `/opusworkflow` used MiniMax for execution (effectiveness ceiling). v2 replaces that with Sonnet 4.6 (2026's ceiling for routine code). Multispec adds DAG-aware parallelism and rollup verify that v1 didn't have.

## Cost shape on Max plans

| Sub-Specs | Mode | /opussonnet (Sonnet exec) | /opusolo (Opus exec) |
|---|---|---|---|
| 3–5 | Mode A (subagents) | ~$2–5 credit | ~$6–15 credit |
| 6–10 | Mode B (Agent Teams) | ~$5–12 credit | ~$15–35 credit |
| 11+ | Mode B (Agent Teams) | ~$10–25 credit | ~$30–75 credit |

On Max 20x ($200/mo credit): ~15–25 multispec runs/month at typical scope. On Max 5x ($100/mo): ~5–10/month.

## What goes in writeSetByspecId

For each sub-Spec, the decomposer annotates which files it will modify. The engine uses this to:

1. Detect write-set overlap → forces Mode B (worktree isolation) when overlapping.
2. Serialize same-file packets within Mode A.
3. Build the dependency DAG correctly when sub-Specs share inputs.

## Open programmatic API

```typescript
import { decomposeIntoMultiSpec, selectParallelMode } from "@claudemax/runtime";

const multispec = await decomposeIntoMultiSpec("rewrite the storage engine", { cwd: "." });
console.log(multispec.mode);   // "auto" -> "solo" or "teams" based on shape
console.log(multispec.modeReason);
```
