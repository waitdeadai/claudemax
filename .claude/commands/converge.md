---
description: Run the full claudemax converge loop on a goal — deepresearch → verify-research → Fable 5 decompose → era-aware Opus/Sonnet execution → blind Opus verify, looped to a verified DONE
allowed-tools: Bash(cmax *), Bash(node *)
---

Run the claudemax converge loop on this goal:

**Goal:** $ARGUMENTS

Execute:

```bash
cmax loop run "$ARGUMENTS"
```

Notes for you (the assistant):
- Run it in the foreground via Bash with a generous timeout (600000ms), streaming output. If it exceeds the Bash timeout, re-run with `run_in_background: true` and monitor the output file, reporting each pass line (`pass N: rollup <verdict> X/Y → <action>`) as it appears.
- The model roles are automatic — do NOT add model flags unless the user asked: Fable 5 authors the decompose (while included on Max, →2026-06-22), the executor is era-aware (Opus 4.8 `xhigh` pre-split / Sonnet 4.6 post-split), and the blind verify is always Opus 4.8.
- If the user appended flags after the goal text (e.g. `--max-passes 6`, `--max-credit 80`, `--fable`, `--opusolo`, `--lean`, `--mvp`), pass them through to `cmax loop run` verbatim and exclude them from the quoted goal string.
- When the loop finishes, report: final action (done / stopped / budget), passes used, rollup verdict counts, and total credit estimate — taken from the command output, not inferred.
- If `cmax` is not on PATH, fall back to `node ~/.claudemax/packages/cli/dist/index.js loop run ...`.
