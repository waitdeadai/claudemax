---
name: tdd
description: Test-driven cycle enforced as a hard sequence — write the failing test FIRST, implement only enough to make it pass, then prove the test passes. Opt-in via `cmax ask "<goal>" --tdd` or invoke `/tdd <goal>` directly. Designed for completion conditions whose verifyHint names a test command; for behavior-only verifyHints it explicitly says so instead of faking.
---

# /tdd — test-first cycle

A strict three-phase loop that prevents the most common failure mode: production code that passes only because the test was weakened after the fact.

## Phases (enforced sequentially)

1. **Write failing test** — author a test that asserts each SPEC completion condition. Run the test command. It MUST fail. If it passes immediately, the test is not asserting the right thing — fix the test, not the code.
2. **Implement** — smallest change to production code that could plausibly make the failing test pass. Do not modify the test in this phase.
3. **Verify test passes** — re-run the test command. Exit code must be 0 and the new assertion must appear in passing output. If not, return to phase 2 — never weaken the test.

## When to invoke

- `cmax ask "<goal>" --tdd` — fold the TDD cycle into the multispec pipeline (per sub-Spec where a test verifyHint exists).
- `cmax tdd <spec-path>` — single-spec TDD run.
- Direct skill `/tdd <goal>` from inside Claude Code — invokes the runtime helper.

## Final block (mechanically parseable)

```
FINAL TDD BLOCK
PHASE: failing-test-written | implementation-done | test-passes | stalled
FAILING TEST PATH: <path or none>
EVIDENCE:
- <command and its observed exit code>
- <path to test that asserts the completion condition>
- <path to production code that was modified>
NOTES: <one paragraph; explain blockers if stalled>
```

## When NOT to use

- Completion conditions that are purely behavioral with no test surface (UI affordances, copy changes, visual regression) — TDD will say `stalled` and explain why. Use `/verify` with an `interactive` verifyHint instead.
- One-line trivial edits where authoring a failing test takes longer than the change.
- Pure research / planning sub-Specs.

## Why this is load-bearing

The verifier finds about one in five "solved" tasks are semantically incorrect on Verified-style benchmarks. The most reliable counter is keeping the assertion authored before the implementation, then refusing to relax it. The TDD skill enforces that order at the runtime layer, not as a guideline.
