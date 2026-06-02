---
kind: decision
slug: production-readiness-contract
title: Production-ready is the default bar — MVP is opt-in (--mvp)
decision: '"Done" in claudemax means production-ready by default, not MVP. multispec decompose auto-appends the Production-Readiness Contract (PRC) — no stubs/TODOs, error handling + edge cases, no regressions, clean types/lint, end-to-end integration — as completion conditions with mechanical verifyHints to every sub-Spec and the rollup. /specqa, /introspect and /verify inherit these. MVP is the explicit exception, requested via --mvp, never the default.'
rationale: 'The over-claiming failure is not only a weak verifier — it is a weak BAR ("el bar es el bug"). If the completion conditions encode only "works", the agent satisfies "works" and is genuinely done by that low bar, then the demo breaks in production. Asking for "production-ready" per goal gets gamed; baking it in as the harness default does not. This is Specification Self-Correction applied to the bar: the spec is hardened to production BEFORE execution. PRC conditions carry mechanically-checkable verifyHints so the decomposed + adversarial verifier and the deterministic stub gate can enforce them with evidence.'
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-06-02
ttl_days: 365
tags: [prc, bar, done, production-ready, multispec, verify, hard-rule]
source: docs/EFFECTIVENESS_OS.md
---

## Decision

Production-ready is the default "done" bar. `multispec decompose` auto-augments
every sub-Spec's completion conditions (and the rollup) with the PRC criteria,
each with a mechanically-checkable verifyHint:

- **prc-no-stubs** — no TODO/FIXME/stub/placeholder/NotImplemented in changed
  production source (enforced cheaply by the `cmax-stub-gate.sh` PreToolUse hook).
- **prc-error-handling** — inputs validated, failure paths graceful, no swallowed
  errors; proven by a failure-mode test.
- **prc-edge-cases** — coverage beyond the happy path.
- **prc-no-regressions** — existing tests stay green.
- **prc-types-lint** — typecheck + lint clean.
- **prc-integration** — wired end-to-end from a real entry point, not an island.

MVP is the explicit exception: `cmax run … --mvp` (and `decompose({ mvp: true })`)
suppress the augmentation. There is no "production mode" flag — production IS the
floor; `--mvp` is how you step below it.

## Rationale

`xhigh` effort does not close the proxy↔intent gap — a low bar plus more effort
just games the low bar harder. Encoding the bar into the harness (not the prompt)
is the lever. PRC conditions are verifiable with evidence, so they compose with the
default-FAIL verdict gate (the verdict artifact) and the adversarial verifier.

## Alternatives rejected

- Asking for "production-ready" in each goal prompt — rejected; gets gamed like any
  other soft instruction.
- A `--production` opt-in flag — rejected; inverts the default the wrong way.
  Production is the floor; MVP is the opt-out.

## Consequences

- More completion conditions per sub-Spec → more per-condition verifier work. This
  is intended (verify is the source of truth) and is tunable; `--mvp` is the escape.
- `/specqa` and `/verify` see PRC conditions as ordinary (verifyHint-bearing)
  conditions and enforce them with the same machinery.
