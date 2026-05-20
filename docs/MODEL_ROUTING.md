# Model routing — plan-aware

Router lives in `packages/core/src/router.ts`. Legible heuristics: baseline table + escalation triggers + plan-aware cost-guard.

## Baseline table

| Task class | Tier | Why |
|---|---|---|
| `plan` | Opus | Reasoning over goal-sized context |
| `architect` | Opus | Multi-file, multi-system design |
| `spec` | Opus | The contract; worth the spend |
| `verify` | Opus | Independent skepticism (supervisor) |
| `audit` | Opus | Read for holes, not skim |
| `debug-hard` | Opus | Subtle, multi-cause, easy to fool |
| `implement` | Sonnet | Routine coding, fast and capable |
| `refactor` | Sonnet | Mechanical transforms |
| `test` | Sonnet | Test scaffolds, fixtures |
| `search`, `summarize` | Haiku | Cheap throughput |
| `classify`, `route` | Haiku | The router itself can call out |

## Escalation triggers (Sonnet → Opus)

Baseline-Sonnet packets escalate to Opus when **any**:

- `complexity ≥ 7`
- `novelty ≥ 8` (no similar pattern in memory)
- `priorFailure` (memory records failure on similar packet)
- `domain ∈ {auth, authentication, authorization, crypto, payments, billing, secrets, session}`
- explicit `--tier opus` / `signal.explicitTier === "opus"`

## Demotion triggers (Opus → Sonnet) — NEVER for verify/spec/architect

The router demotes Opus baselines to Sonnet ONLY when:

- `forceCheap: true` AND task class is not in NEVER_DEMOTE set.
- Plan-aware cost-guard (see below).
- Cost ceiling exceeded AND Sonnet estimate fits AND not in NEVER_DEMOTE set.

`NEVER_DEMOTE = {verify, spec, architect}`. Hard rule.

## Plan-aware cost-guard

| Credit consumed % | Tag | Behavior |
|---|---|---|
| < 70% | ok | No demotion. Effectiveness-max defaults stand. |
| 70–90% | guard | Demote non-essential Opus → Sonnet (never NEVER_DEMOTE). |
| 90–95% | danger | Aggressive demote. Warn loudly. |
| > 95% | blocked | `cmax run` requires `--force` past this. |

Identical thresholds for Max 5x and Max 20x; only the absolute dollar numbers differ.

| Plan | 70% | 90% | 95% |
|---|---|---|---|
| Max 20x ($200) | $140 | $180 | $190 |
| Max 5x ($100) | $70 | $90 | $95 |
| Pro ($20) | $14 | $18 | $19 |
| api | n/a | n/a | n/a |

## Tier pricing (estimates for budgeting, May 2026)

| Tier | Input/1M | Cached input/1M | Output/1M |
|---|---|---|---|
| Opus | $15 | $1.50 | $75 |
| Sonnet | $3 | $0.30 | $15 |
| Haiku | $1 | $0.10 | $5 |

## Per-packet cost estimate

```typescript
inputTokens  = 8_000 + complexity * 4_000
outputTokens = 2_000 + complexity * 1_500
```

These are estimates for budgeting, not billing. Actual billing comes from Anthropic.

## Overriding the router

```typescript
import { route, classifyHeuristic } from "@claudemax/core";
import { detectPlan } from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

const plan = detectPlan();
const memory = new MemoryStore({ path: ".claudemax/memory.sqlite" });
const consumed = memory.creditConsumedThisPeriod();

const decision = route(
  {
    class: classifyHeuristic(taskSummary),
    complexity: 5,
    novelty: 3,
    summary: taskSummary,
  },
  {
    plan: plan.plan,
    creditConsumedUsd: consumed,
    costCeilingUsd: 0.5,
  },
);
console.log(decision.tier, decision.reasoning);
```

Or from the CLI:

```bash
cmax route "rewrite the JWT verifier" --complexity 6 --domain auth
cmax route "summarize 200 commits" --tier haiku
cmax route "design the cache layer" --tier opus --cost-ceiling 2
```
