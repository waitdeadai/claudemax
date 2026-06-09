# Model routing — plan-aware

Router lives in `packages/core/src/router.ts`. Legible heuristics: baseline table + escalation triggers + plan-aware cost-guard.

## Fable 5 — the fourth tier (added 2026-06-09, launch day)

Claude Fable 5 (`claude-fable-5`) sits ABOVE Opus, not in the baseline table.
Anthropic's own selection matrix keeps Opus/Sonnet/Haiku as the three rows and
positions Fable as the escalation for "the most demanding reasoning and
long-horizon agentic tasks" ([choosing-a-model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model),
[model-config](https://code.claude.com/docs/en/model-config), accessed 2026-06-09).
The harness mirrors that: **baselines unchanged; Fable is escalation-only.**

When Fable is invoked:

- `signal.longHorizon: true` on a `plan` or `debug-hard` packet (work "larger
  than a single sitting": overnight/`cmax overnight` runs, multi-day converge
  loops, ambiguous root-cause hunts) — auto-escalates opus→fable.
- Explicit override: `--tier fable` / `signal.explicitTier: "fable"` (the route
  for architecture decisions, since `/architect` stays pinned to Opus by house
  rule #4).

When Fable is NOT invoked:

- `verify` / `spec` / `architect` — pinned to Opus (house rule #4), neither
  demoted nor auto-escalated.
- Security domains (auth, payments, crypto, …) — Fable's safety classifiers
  fall back to Opus 4.8 on cybersecurity-shaped requests, and in SDK/headless
  mode a flagged request ends the turn with a refusal. Route straight to Opus.
- Sonnet-baseline execution (`implement`/`refactor`/`test`) — Anthropic
  publishes no latency rating for Fable (insufficient_data as of 2026-06-09)
  and pitches it for judgment, not throughput. Execution stays Sonnet.

Billing caveat: Fable is included on Max at no extra cost only **through
2026-06-22**; after that it bills to **usage credits** — real incremental spend
even while Opus/Sonnet draw from the subscription pool. Check
`fableOnUsageCredits()` in `packages/core/src/cost.ts`.

SDK invocation: pass the full id `claude-fable-5` in `query()` options —
`fable` is a Claude Code CLI alias, not a documented SDK alias (as of
2026-06-09). Never send `thinking: {type:"disabled"}` to Fable (unsupported;
adaptive thinking is always-on — omit the param). `fallbackModel` for Fable
packets is Opus, mirroring Claude Code's own classifier-fallback target.
Requires Claude Code ≥ 2.1.170.

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

## Demotion triggers — NEVER for verify/spec/architect

The router demotes Fable/Opus ONLY when:

- `forceCheap: true` AND task class is not in NEVER_DEMOTE set → Sonnet
  (fable and opus both drop straight to sonnet — cheap means cheap).
- Plan-aware cost-guard (see below). At `guard` the demotion is one rung:
  fable→opus (keeps judgment quality, sheds the 2× premium), opus→sonnet.
  At `danger`/`blocked` everything drops to sonnet.
- Cost ceiling exceeded AND a cheaper tier fits AND not in NEVER_DEMOTE set.
  Fable tries opus first, then sonnet.

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

## Tier pricing (estimates for budgeting, verified 2026-06-09)

| Tier | Input/1M | Cached input/1M | Output/1M |
|---|---|---|---|
| Fable (5) | $10 | $1.00 | $50 |
| Opus (4.8) | $5 | $0.50 | $25 |
| Sonnet (4.6) | $3 | $0.30 | $15 |
| Haiku (4.5) | $1 | $0.10 | $5 |

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
cmax route "plan the multi-day billing migration" --long-horizon   # → fable
cmax route "decide the storage architecture" --tier fable          # explicit
```
