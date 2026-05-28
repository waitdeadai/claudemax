# Haiku Judge — verifier-doubleCheck (claudemax-internal scope)

Status: **scoped down to verifier-doubleCheck only** (2026-05-23). The
broader BLOCK/REDACT/WARN/LOG dark-patterns hook cascade originally
drafted in commit `b9cb03b` was reverted as duplicative + unvalidated.
The canonical Haiku-tier cascade for dark-patterns hooks lives in the
sibling repo:

> **[waitdeadai/llm-dark-patterns v5 (PR #26)](https://github.com/waitdeadai/llm-dark-patterns/pull/26)** — `feature/v5-cascade-haiku-tier` merged into main `e9172ae` on 2026-05-23.

Use that. It has bootstrap-CI numbers on held-out + fresh corpora,
cross-judge κ=1.0 analysis proving Haiku == Sonnet on WARN cases, and
explicit caveats about circularity. Empirically validated, adversarially
defended, intellectually honest.

## What lives in claudemax (and only here)

Only **one** Haiku-tier feature stays in this repo, because it has no
counterpart in llm-dark-patterns and addresses a real failure mode we've
observed multiple times this session:

### Verifier double-check (`packages/runtime/src/verify.ts`)

When `verify()` is called with `{ doubleCheck: true }`, after the Opus
verifier produces its per-condition findings and a `verdict ∈ {verified,
partial, failed}`, a Haiku 4.5 cross-model recall check runs on the same
evidence package. It is **WARN-only**: on disagreement, the report's
`notes` gains a non-authoritative `⚠ haiku-recall-check` warning and **the
Opus verdict STANDS** — it is never overridden. Opus is the authority
(house rule #4); Haiku only boosts recall on false-passes.

This is the **v5-aligned cascade shape** (2026-05-28): a strong floor +
a cheap-LLM WARN ceiling. The earlier behavior — Haiku *overriding* the
Opus verdict to `"unverified"` on any disagreement — was a weak-judge-
overrides-strong anti-pattern (the exact inversion the llm-dark-patterns
v5 study argues against, mirroring its WARN-only / fire-on-floor-pass
contract) and was removed.

Motivation: catch FALSE-PASSES — conditions Opus accepted as met that the
evidence doesn't clearly support (the over-optimism / sycophancy failure
mode). A human is alerted via the warning to look, without the verdict
being flipped by the weaker judge.

Wiring:
```typescript
import { verify } from "@claudemax/runtime";
const report = await verify(spec, { cwd, doubleCheck: true });
// verdict is ALWAYS Opus's (never overridden by Haiku). A disagreement
// surfaces as a non-authoritative warning appended to report.notes:
if (report.notes.includes("haiku-recall-check")) {
  // Haiku flagged a possible false-pass — surface to a human; verdict unchanged.
}
```

Opt-in only — `doubleCheck` defaults to `false`. The bare `verify()`
behaves identically to before.

### Validation status

**Not empirically measured.** Unlike llm-dark-patterns v5 (which has
bootstrap-CI numbers on held-out + fresh corpora, cross-judge κ=1.0
analysis, and explicit caveats about circularity), the verifier
double-check is currently a design + 4-test regression suite — no
held-out corpus, no measured agreement rate against ground-truth.

Because the tier is now **WARN-only** (it can never flip the verdict), it
is strictly additive — the worst case is a noisy warning, never a wrongly-
overridden verdict. If you ship `doubleCheck: true`, treat the resulting
`haiku-recall-check` warnings as **candidate flags**, not validated
disagreements. A real validation effort would:
1. Collect ~30 cmax-ask runs where `pnpm typecheck && test` is green
   but rollup verdict is non-verified.
2. Score how often Haiku's second-opinion correctly downgrades vs
   incorrectly agrees with Opus.
3. Report bootstrap-CI per-mode recall + control FP.

That work is not done. The feature ships as an opt-in candidate flagger.

## Why verifier-doubleCheck is NOT in llm-dark-patterns

llm-dark-patterns is a closeout-text safety library — it judges the
LAST ASSISTANT MESSAGE for honesty patterns. It has no concept of a
SPEC, no verifier, no per-condition findings. Verifier-doubleCheck
operates on internal claudemax state (the `VerificationReport`
structure with its `perCondition[]`), which only exists inside the
harness's run loop. The two libraries serve adjacent but disjoint
problems.

## Cost guard (kept from b9cb03b)

`packages/runtime/src/haiku-judge.ts` reads `budgetTag()` from
`packages/core/src/cost.ts`. When monthly credit consumption exceeds
70%, the Haiku call is skipped and `doubleCheck` becomes a no-op for
that invocation (the report is returned as-is from Opus). Documented
behavior — surfaces in the report when this guard fires.

## What was reverted from b9cb03b + why

| Reverted | Why |
|---|---|
| `packages/cli/src/commands/verdict-judge.ts` | Generic CLI wrapper for hook escalation. llm-dark-patterns v5 calls `claude -p --model haiku` directly; no need for cmax CLI shim. |
| `skills/dark-patterns/lib/haiku-judge.sh` | Bash helper for hooks to spawn the CLI. Same as above — duplicates the v5 pattern with less validation. |
| `skills/dark-patterns/hooks/no-vibes.sh` (POC) + `no-emoji-spam.sh` (POC) | Demo opt-in escalation hooks. llm-dark-patterns ships the actual battle-tested hooks; POCs in this repo would diverge from the canonical source. |
| Generic BLOCK/REDACT/WARN/LOG action richness on hooks | Designed but unproven. v5's strict WARN-only + regex-negative gating + frozen-labels-for-determinism is more rigorous and empirically validated. |

What survived: `packages/runtime/src/haiku-judge.ts` (minimal —
`judgeWithHaiku` function used internally by `verify.ts` doubleCheck;
not exposed as a public hook surface), `packages/runtime/src/verify.ts`
doubleCheck arg, `packages/runtime/tests/verify-doublecheck.test.ts`,
`packages/runtime/src/haiku-judge.test.ts`, the `"unverified"` verdict
variant in `packages/core/src/types.ts`.

## References

- llm-dark-patterns v5 SPEC: <https://github.com/waitdeadai/llm-dark-patterns/blob/main/evaluation/v5/SPEC.md>
- llm-dark-patterns v5 RESULTS: <https://github.com/waitdeadai/llm-dark-patterns/blob/main/evaluation/v5/RESULTS.md>
- Adversarial cascade early-termination vuln: [arXiv:2605.17288](https://arxiv.org/abs/2605.17288)
- LLM self-preference bias: [arXiv:2410.21819](https://arxiv.org/abs/2410.21819)
- Tranquera (Platanus Hack 26 ar-team-22, original inspiration for the cascade pattern): <https://github.com/platanus-hack/platanus-hack-26-ar-team-22>
