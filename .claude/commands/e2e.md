---
description: End-to-end autonomous delivery — brainstorm the rough idea into a sharp goal, then run the full claudemax converge loop (deepresearch → verify-research → Fable 5 decompose → era-aware Opus/Sonnet execution → blind Opus verify) until verified DONE
allowed-tools: Bash(cmax *), Bash(node *), Read, Glob, Grep
---

Rough ask from the user: $ARGUMENTS

You are driving an end-to-end autonomous delivery. Execute these phases in order:

## 1. BRAINSTORM (you, in this session — do not delegate this)

Sharpen the rough ask into ONE unambiguous goal sentence with a measurable definition of done. Ground it first: Read/Glob the current repo (if one exists) for stack, conventions, and existing scope so the goal fits the project rather than imagining a greenfield. Think about what the user is really trying to ship, what "production-ready" means for it, and what the riskiest unknowns are — that thinking improves the goal sentence, and the pipeline's own deepresearch + Fable decompose will handle the deep exploration.

- If the ask is ambiguous on a decision that changes WHAT gets built (target stack, audience, scope boundary), ask AT MOST one compact question, then proceed.
- Otherwise proceed without asking. Bias to motion.

Echo the result as:

```
GOAL: <one sentence, measurable done>
NON-GOALS: <1-3 bullets, only if they prevent scope creep>
```

## 2. LAUNCH THE LOOP

```bash
cmax loop run "<the sharpened GOAL sentence>"
```

- Run via Bash with a 600000ms timeout; if it outlives that, re-run with `run_in_background: true` and monitor the output file, relaying each `pass N: rollup <verdict> X/Y → <action>` line as it appears.
- Model roles are automatic — do NOT add model flags unless the user asked: Fable 5 authors the decompose (while included on Max →2026-06-22), execution is era-aware (Opus 4.8 `xhigh` pre-split / Sonnet 4.6 post-split), blind verify is always Opus 4.8, and the research findings are verified per-claim before decompose.
- Pass through any flags the user appended (`--max-passes`, `--max-credit`, `--fable`, `--opusolo`, `--mvp`, `--lean`, `--tdd`), excluding them from the quoted goal.
- If `cmax` is not on PATH, use `node ~/.claudemax/packages/cli/dist/index.js loop run ...`.

## 3. DELIVER (honest closeout)

Report ONLY from the command output, never inferred: final action (done / blocked / stop-budget / stop-max / stop-stuck), passes used, rollup verdict counts, total credit estimate.

- `done` → summarize what was built and where; the work sits in the working tree. Offer to commit/push — do NOT commit without the user's explicit go (ship rule).
- `stop-budget` / `stop-max` → state exactly which completion conditions remain unmet (from the rollup output) and offer one re-run command with raised ceilings.
- `blocked` → quote the concrete blocker verbatim and what the user must decide or provide.
