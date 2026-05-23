# Haiku Judge — Tier-3 LLM Validator in the Claudemax Cascade

Status: design doc, WARN-first rollout. Model id: `claude-haiku-4-5-20251001`
(short name `haiku`, family Claude Haiku 4.5).

## Why this exists

Claudemax already enforces output quality with two cheap tiers — regex
fallback and the `agentcloseout-physics` deterministic scorer. They catch the
loud failures (missing `EVIDENCE:`/`STATUS:` blocks, "ready/shipped/done"
without an artifact, fabricated test output). What they cannot do is
**read a paragraph and decide whether the worker is bullshitting**. That is
the gap a small LLM judge fills.

This doc specifies the third tier: a Haiku 4.5 judge that runs only when the
cheap tiers escalate, returns one of four discrete actions, and gets gated by
the existing 70% `budgetTag` guard so it cannot quietly eat the monthly
credit envelope.

## Architectural inspiration

The pattern is taken directly from **Tranquera**
(<https://github.com/platanus-hack/platanus-hack-26-ar-team-22>), a
hackathon project that put a tiered safety cascade in front of an LLM
agent. We have read the README; we are **NOT** vendoring its code, copying
its prompts, or pulling it as a dependency. The architectural idea —
"cheap deterministic check first, escalate to a small LLM only when
ambiguous" — is the borrowed piece. Implementation, prompts, integration
points, and action vocabulary are all written from scratch against the
claudemax surface.

The cost-shape of the cascade is also consistent with the FrugalGPT result
(Chen, Zaharia, Zou — "FrugalGPT: How to Use Large Language Models While
Reducing Cost and Improving Performance",
<https://arxiv.org/abs/2305.05176>), which shows that LLM cascades with
cheap-first routing can match large-model quality at a fraction of the
spend. (Reference identifier recalled from training memory; URL points at
the canonical arXiv landing page — verify against the primary source
before citing in external work.) The 70%-budget gate and the
WARN-first rollout below are the claudemax-specific knobs on top of that
general result.

## The three-tier cascade

```
┌─────────────┐    ┌──────────────────────────┐    ┌─────────────────────────┐
│ Tier 1      │ →  │ Tier 2                   │ →  │ Tier 3                  │
│ Regex       │    │ agentcloseout-physics    │    │ Haiku 4.5 LLM judge     │
│ ~µs         │    │ ~1ms deterministic       │    │ ~200–400ms, ~$0.002/call│
│ allow-list  │    │ scorer (Rust)            │    │ semantic judgment       │
└─────────────┘    └──────────────────────────┘    └─────────────────────────┘
   PASS / FAIL          PASS / FAIL / ESCALATE         BLOCK / REDACT / WARN / LOG
```

- **Tier 1 (Regex).** Microseconds. The fallback baked into
  `skills/dark-patterns/*` hooks. Matches obvious "shipped/ready/done"
  prose without an `EVIDENCE:` block. Returns PASS or FAIL.
- **Tier 2 (`agentcloseout-physics`).** ~1ms deterministic scorer
  (installed by `setup.sh` via cargo-binstall; see CLAUDE.md §12). Adds
  Status-header recognition, evidence-block parsing, and an explicit
  ESCALATE verdict when a closeout is structurally plausible but
  semantically suspicious (e.g. positive verbs paired with hedged
  failure-shaped phrases).
- **Tier 3 (Haiku judge).** Only runs on ESCALATE. The escalation rate
  in our shadow logs is ~3–6% of closeouts, which is what makes the
  cost math work.

Tier 1 and Tier 2 already exist. This doc is about wiring Tier 3.

## Action vocabulary: BLOCK / REDACT / WARN / LOG

Today claudemax has a binary disposition — the hook either allows the
turn or blocks it. That is too crude for a probabilistic judge. The Haiku
verdict is one of four discrete actions:

- **BLOCK** — refuse the closeout, return the judge's reason to the
  worker, force a retry. Reserved for high-confidence dark-pattern
  matches: invented test output, fabricated git SHAs, claims of work the
  diff does not contain. This is the only action that affects worker
  flow.
- **REDACT** — allow the closeout but strip / rewrite the offending
  span before it reaches the parent context. Used for "claim is
  unverifiable but probably harmless" — e.g. a vague "performance
  improved" without a number. The redaction is logged alongside the
  original so a human reviewer can audit.
- **WARN** — let the closeout through unchanged, attach a structured
  warning to the verifier ledger and the run summary. Default disposition
  during rollout (see §"WARN-first rollout").
- **LOG** — record the verdict and the prompt/response pair into
  `memory.judge_decisions` for offline analysis. Used for borderline
  cases where the judge itself is uncertain (logged
  `confidence < 0.6`). LOG never blocks, never warns the user; it just
  builds the training corpus for future tier-2 rule extraction.

The four actions are ordered by user-visible severity: BLOCK >
REDACT > WARN > LOG. A hook author picks the **maximum** action the
judge may take for that hook; if the judge wants to escalate above the
cap, it falls back to the cap and tags the verdict with
`capped: true`.

## Fail-CLOSED — the inversion vs Tranquera

Tranquera's reference design is **fail-OPEN**: if the Haiku call times
out, errors, or hits a quota wall, the request is allowed. That is the
right default for a public-facing safety filter where false-positives
have a real UX cost.

Claudemax inverts this. The judge is **fail-CLOSED**:

- If the Haiku call errors → action escalates to **BLOCK** with reason
  `judge_unavailable`.
- If the Haiku call exceeds its latency budget (default 800ms) → BLOCK
  with reason `judge_timeout`.
- If the response fails JSON-schema validation → BLOCK with reason
  `judge_malformed`.
- If `budgetTag()` returns `blocked` (≥95% of plan credit consumed) →
  BLOCK with reason `judge_budget_blocked` (the judge itself is not
  called).

The rationale: a worker that produced a closeout the cheap tiers couldn't
score is already in suspect territory. The cost of a false-block is one
retry; the cost of a false-allow is corrupted memory and downstream
contamination. We pay the retry.

This is overridable per-hook via `failOpen: true` in the hook's judge
config, but the default and the recommendation is fail-CLOSED.

## Cost math — per-call, with caching

Pricing as registered in `packages/core/src/models.ts` (Haiku 4.5,
accessed 2026-05-23):

- input: **$1.00 / MTok**
- output: **$5.00 / MTok**
- cached input read: **$0.10 / MTok** (10× discount)
- cache write (5m TTL): **$1.25 / MTok**

Typical judge call: ~1500 input tokens (system prompt + rubric +
closeout snippet) + ~120 output tokens (action + confidence + reason).

Naive per-call cost (no caching):

  `1500/1e6 × $1 + 120/1e6 × $5 = $0.0015 + $0.0006 = $0.0021`

With prompt caching (the system prompt + rubric are static and amortise
over the 5-minute TTL; only the closeout snippet is "fresh" input):

- static prefix ~1300 tokens, served from cache → `1300/1e6 × $0.10
  = $0.00013`
- fresh suffix ~200 tokens, billed at full input rate → `200/1e6 ×
  $1 = $0.0002`
- output ~120 tokens → `120/1e6 × $5 = $0.0006`
- cached per-call cost: **~$0.00093** (~55% discount vs naive)

At a 5% escalation rate over ~500 closeouts/day, that is
`0.05 × 500 × $0.00093 ≈ $0.023/day` — about 70¢/month at sustained
use. Well inside the 70% guard threshold of even the Max 5x plan, and
trivial against Max 20x.

## The 70% budgetTag gate

The judge is **opt-in per hook** but globally gated by
`budgetTag(plan, consumedUsd, era)` from `packages/core/src/cost.ts`:

- `ok` (<70% of plan credit) → judge runs normally.
- `guard` (70–90%) → judge is **disabled** for hooks that did not opt
  into `runOnGuard: true`. The cascade falls back to the tier-2
  verdict (so ESCALATE becomes ALLOW, not BLOCK).
- `danger` (90–95%) → judge is disabled for **all** hooks regardless
  of `runOnGuard`. Tier-2 verdict wins.
- `blocked` (≥95%) → judge calls are refused upfront with
  `judge_budget_blocked`; under fail-CLOSED this becomes BLOCK, which
  is intentional — at 95% credit consumption the user has bigger
  problems than a Haiku call.

The gate inherits the era-awareness of the existing budget machinery
(pre-split era: `budgetTag` always returns `ok`, so the gate is a no-op
until 2026-06-15). See `CLAUDE.md` §"Billing era" and
`packages/core/src/cost.ts` for the source of truth.

## Opting in from a hook

A claudemax hook opts into the Haiku tier by exporting a `judge` block in
its config (sketched here; final shape will live in
`packages/runtime/src/judge.ts`):

```jsonc
{
  "name": "dark-patterns/closeout-honesty",
  "tier1": { "regex": "..." },
  "tier2": { "scorer": "agentcloseout-physics" },
  "judge": {
    "enabled": true,
    "model": "claude-haiku-4-5-20251001",
    "maxAction": "WARN",
    "runOnGuard": false,
    "failOpen": false,
    "latencyBudgetMs": 800,
    "rubric": "rubrics/closeout-honesty.md"
  }
}
```

Defaults if the block is omitted: judge disabled, cascade stops at
tier 2. A hook author who does not touch the judge config gets the
current behavior.

## The verifier `doubleCheck` flag

`/verify` runs as a separate pass after a SPEC's completion conditions
report green. The verifier can request a Haiku second opinion on its own
verdict via a `doubleCheck: true` flag in the verifier config:

- When set, every "PASS" the verifier emits is sent to the Haiku judge
  along with the SPEC condition, the verifyHint, and the evidence
  string the verifier collected.
- The judge returns BLOCK (verifier is wrong, condition is not actually
  met) or WARN (verifier is plausibly right but evidence is thin) or
  LOG (verdict accepted).
- A BLOCK from the doubleCheck pass demotes the verifier verdict to
  FAIL with reason `judge_disputed`; the SPEC condition is reopened.

`doubleCheck` is **off by default** — `/verify` already runs on Opus and
is the source of truth for SPEC completion (see CLAUDE.md §4). The flag
exists for two scenarios: (a) high-stakes SPECs where one extra cheap
pass is worth the latency, and (b) catching the specific failure mode
where Opus rubber-stamps its own previous work.

## WARN-first rollout policy

We are not turning on BLOCK for any production hook on day one. The
rollout is staged:

1. **Phase 0 — LOG only (week 0–2).** Every escalation calls the judge
   with `maxAction: LOG`. We collect prompts, responses, and the
   `agentcloseout-physics` verdict side-by-side in
   `memory.judge_decisions`. Goal: measure the false-positive rate and
   build a labelled dataset.
2. **Phase 1 — WARN (week 2–6).** Hooks whose Phase-0 data shows
   judge/scorer agreement ≥ 90% promote to `maxAction: WARN`. The
   verdict surfaces in the run summary and the verifier ledger but
   does not change worker flow.
3. **Phase 2 — REDACT (week 6–10).** Promoted only for hooks where the
   redaction surface is well-defined (e.g. strip vague performance
   claims). Requires per-hook sign-off because REDACT silently mutates
   what the parent context sees.
4. **Phase 3 — BLOCK (week 10+).** Only for hooks where the
   false-positive rate from Phase 1 was below 1%, and only for
   high-confidence dark-pattern matches. A BLOCK roll-back is a
   single-line config change.

Promotion between phases is gated on the data, not the calendar — the
week markers above are floors, not ceilings. The `/harness-audit` skill
(see CLAUDE.md §"Lean catalog") is the quarterly forcing function for
re-examining whether any judge-equipped hook should be demoted or
removed.

## What's explicitly out of scope

- No multi-model cascade (Sonnet/Opus as tier-4). The whole point of
  the FrugalGPT-style design is that escalation stops at the cheapest
  model that can answer.
- No streaming judge output. Verdicts are one-shot JSON.
- No judge for inbound user prompts. This is a closeout-validator, not
  a guardrail for the user's own input.
- No automatic prompt extraction from blocked closeouts into training
  data. Phase-0 logging is opt-in per hook and excluded from any
  automated fine-tuning pipeline.

## Pointers

- Cascade entry point (TBD): `packages/runtime/src/judge.ts`
- Cost + budget gate: `packages/core/src/cost.ts`
- Model id + pricing: `packages/core/src/models.ts:59-74`
- Tier-2 scorer install: `setup.sh` (agentcloseout-physics)
- Tranquera (architectural inspiration, not a dependency):
  <https://github.com/platanus-hack/platanus-hack-26-ar-team-22>
- FrugalGPT (Chen, Zaharia, Zou): <https://arxiv.org/abs/2305.05176>
