# Effectiveness OS — implementation plan & living spec

> Implements the roadmap in `claudemax-OS-efectividad-definitivo.md` (the "OS de
> efectividad" master doc). Branch: `feat/effectiveness-os`. This file is the
> living spec: it is re-read at each tranche boundary to resist prompt decay
> (§5.1) and doubles as the PR rationale.

## Thesis

Over-claiming ("says done, isn't") lives in the **proxy ↔ intent gap**: the model
optimizes the verifiable proxy (tests pass, verifyHints satisfied) instead of the
real intent. `xhigh` effort does not close that gap — it can widen it (more effort
optimizing a weak proxy). The gap closes on three fronts at once:

- **A — spec side:** precise, non-gameable acceptance criteria + Specification
  Self-Correction (SSC, [arXiv 2507.18742](https://arxiv.org/abs/2507.18742):
  models game tainted specs 50–70% of the time; SSC cuts that >90% at test-time).
- **B — hard-to-game verification:** decomposed per-condition verify (Graph of
  Verification, [arXiv 2506.12509](https://arxiv.org/abs/2506.12509)) + adversarial
  / isomorphic mutants + evidence-as-file + default-FAIL.
- **C — completion gate:** `Stop`/`SubagentStop` cannot close on a sycophantic
  "done" — a deterministic hook blocks unless an on-disk verdict shows every
  condition met **with evidence**.

The default bar is **production-ready, not MVP** (§2-bis): the bar is baked into
the harness, not requested per-goal.

## Existing vs. delta (verified by read-only gap analysis)

| Front | Already built | Genuine delta (this branch) |
|---|---|---|
| **B verify** | Blind out-of-band Opus verifier, read-only tools, fresh context (B.3 ✓). Haiku double-check is WARN-only. `interactive-verify.ts` runs per-condition probes (playwright/browser/shell) **with `timeoutMs`** already. Schema has `evidenceRequired[]`. | `verify.ts` is **one monolithic Opus query over all conditions** — not decomposed, not parallel, no per-condition timeout. **Verdict never persisted to disk.** Omitted conditions silently dropped (no default-FAIL). **No adversarial/mutation/isomorphic** testing. |
| **C gate** | Large `Stop`/`SubagentStop` dark-pattern battery — gates on **text tells** (sycophancy/vibes/unverified-claim regex). `cmax-stop.sh` observational, always exit 0. | **No hook reads verification state.** No verdict artifact. **No stub/TODO/mock/hardcode diff gate.** |
| **A spec / 2-bis** | `multispec.ts` decomposer already demands verifyHints; `specqa` is a wired gate. | **No production-ready bar (PRC).** **No spec-hardening / SSC / passed-too-easily re-check.** |

## The keystone: the verdict artifact

`verify()` computes a `VerificationReport` in memory and exits 0/1 — nothing on
disk. Every front converges on one missing file. Add a per-condition
`.claudemax/state/verdict-<specHash>.json` (default-FAIL, evidence-as-file) and it
simultaneously unblocks: the Stop gate (C.1), evidence-required (B.4), decomposed
verify (B.1), and adversarial scoring (B.2). It is the dependency root.

```
spec (hardened, PRC-augmented) ─► bounded exec ─► decomposed+adversarial verify
        ▲                                                  │ writes
        └── SSC re-spec if "passed too easily" ◄── verdict-<hash>.json (default-FAIL)
                                                           │ read by
                                          Stop/SubagentStop gate (exit 2 unless verified-with-evidence)
```

## Tranches (each: implement → tests → blind verify → checkpoint)

### T1 — Keystone (Frente B.1/B.4 + C) · §8 #1+#2
- `verify()` writes `verdict-<hash>.json` enumerating **every** completion
  condition, default `met:false` (a condition the model omits ⇒ FAIL; empty
  evidence ⇒ FAIL; verdict default `"unverified"`).
- Decompose verify into **parallel per-condition sub-verifiers** with a hard
  per-unit wall-clock timeout (reuse the interactive-verify timeout/SIGKILL
  pattern); keep blind read-only tools.
- `.claude/hooks/cmax-verdict-gate.sh`: reads latest verdict, **exit 2** unless
  all conditions `met` with non-empty evidence AND `verdict==="verified"`; **no-op
  when no active spec context** (don't block ordinary chat). Wired into Stop +
  SubagentStop.
- PreToolUse stub gate: greps Edit/Write payload for
  `TODO|FIXME|stub|mock|hardcode|NotImplemented|XXX` ⇒ exit 2 (allowlistable).
- **Completion conditions:**
  - `t1-verdict-file` — after `verify()`, a verdict JSON exists with one row per
    `spec.completionConditions`. *verify:* new runtime test asserts file written +
    every cc id present + omitted-cc ⇒ met:false.
  - `t1-parallel-timeout` — per-condition verifiers run concurrently with a
    per-unit timeout; a hung condition fails just itself. *verify:* test with a
    fake slow condition times out to met:false without hanging the batch.
  - `t1-gate-blocks` — gate script exits 2 on a non-verified verdict, 0 on a
    verified-with-evidence one, 0 when no spec context. *verify:* bash test over
    three fixture verdicts.
  - `t1-stub-gate` — stub gate exits 2 on a diff containing `TODO`/`mock`. *verify:*
    bash test over fixture payloads.
  - `t1-green` — `pnpm -r typecheck && pnpm -r test` stay green. *verify:* exit 0.

### T2 — Adversarial / mutation / isomorphic verify (Frente B.2)
- New `packages/runtime/src/mutation-verify.ts`: per condition, generate
  plausible-but-wrong **mutants** the verifier must reject + an **isomorphic**
  (logically-equivalent) restatement it must still pass. Score mutant-rejection
  rate; low rejection ⇒ the verifier (or spec) is gameable ⇒ downgrade.
- **Completion conditions:** `t2-mutants-rejected` (test: injected mutants are
  rejected ≥ threshold), `t2-isomorph-pass` (equivalent restatement still passes),
  `t2-wired` (optional `--adversarial` flag), `t2-green`.

### T3 — PRC production-ready contract + decompose auto-augment (§2-bis)
- `vault/decisions/production-readiness-contract.md` (`invariant:true`).
- `multispec` decompose auto-augments each sub-spec with PRC conditions +
  mechanical verifyHints; `--mvp` opt-out suppresses augmentation.
- `specqa`/`introspect`/`verify` skills inherit PRC.
- **Completion conditions:** `t3-prc-decision`, `t3-augment` (test: decompose adds
  PRC conditions), `t3-mvp-optout` (test: `--mvp` suppresses), `t3-green`.

### T4 — Specification Self-Correction (Frente A.2)
- Spec-hardening pass before execution (remove gameable loopholes) +
  passed-too-easily re-check that re-examines the spec instead of accepting a
  suspiciously-clean verify.
- **Completion conditions:** `t4-harden` (test: tainted spec hardened),
  `t4-easy-pass-recheck` (test: easy pass triggers re-spec), `t4-green`.

### T5 — cmax eval + production-hotfix-rate (§6)
- `cmax eval`: small private task set scaffold (incl. a frontend task), runs the
  pipeline, records verdict + **production-hotfix-rate** (defects after "done") +
  verifier false-positive vs spot-check; ablation flags.
- **Completion conditions:** `t5-eval-cmd`, `t5-metric` (test: hotfix-rate math),
  `t5-ablation`, `t5-green`.

### T6 — Frontend playbook + long-run reliability (§3,§4,§5)
- Frontend: a11y-tree snapshot + screenshot baseline (`maxDiffPixelRatio`) +
  graduable design rubric as evidence artifacts (extends interactive-verify).
- Long-run: spec/invariant re-injection (anti-prompt-decay), durable-artifact
  context reset, decomposed map-reduce synthesis + filesystem handoff for the
  research condenser fan-in.
- **Completion conditions:** `t6-frontend-evidence`, `t6-reinject`,
  `t6-mapreduce`, `t6-green`. Playwright MCP availability noted honestly.

## Dogfood Definition of Done (§9)

- No "done" without an on-disk verdict whose every condition is met **with
  evidence** (T1 gate enforces this on the harness itself).
- No diff with stub/TODO/mock/hardcode passes the gate.
- Adversarial verify rejects ≥ threshold of injected mutants (T2).
- `pnpm build && typecheck && test && smoke` green at the end; baseline regression
  floor: runtime 203 / cli 8 / memory-mcp 8 tests, all still passing.
- Every tranche independently blind-verified before it is called done.

## Non-goals (this branch)

- No new third-party runtime deps (Anthropic-only invariant holds).
- No weakening of the existing dark-pattern hook battery (additive only).
- Frontend baselines/VLM-judge depend on Playwright MCP; absence is reported, not
  faked.
