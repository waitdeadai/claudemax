# Loop mode — user guide

> `cmax loop` makes the **loop** a first-class unit of work in claudemax — the
> paradigm Boris Cherny describes ("I don't prompt Claude anymore… my job is to
> write loops"). Design rationale + sources: [`LOOP_MODE_PLAN.md`](./LOOP_MODE_PLAN.md).
>
> Two archetypes, one verify-gated, budget-guarded engine:
> - **`cmax loop run`** — drive ONE goal to DONE (converge-loop).
> - **`cmax loop add`** — a standing, scheduled, input-driven loop (the Boris pattern).

There is no `/loop` skill — that name belongs to Claude Code's native built-in.
claudemax exposes loop mode as the `cmax loop` CLI (the same reason `/workflow`
was retired: don't shadow a native primitive).

## Archetype A — converge-loop (`cmax loop run`)

Drive a single goal to a verified DONE through repeated **fresh-context**
`iterate → verify → decide` passes. The loop body is the existing harness: `runGoal`
advances, the blind `verify` (always Opus, never demoted) is the source of truth,
and a pure state machine decides what happens next.

```bash
cmax loop run "add a --json flag to `cmax doctor` and cover it with a test"
cmax loop run "<goal>" --max-passes 8 --max-credit 40 --respec-after 2 --opusolo
```

The decision after each pass (`packages/core/src/loop.ts › decideNext`, pure +
unit-tested):

| Outcome | When |
|---|---|
| **done** | every completion condition met with evidence (the only success exit) |
| **blocked** | the advance reported a concrete external blocker — needs a human |
| **iterate** | progress is being made (or below the stall threshold) — go again |
| **respec** | N consecutive no-progress passes → the spec is probably wrong; rebuild it |
| **stop-budget / stop-max** | credit or pass ceiling hit → checkpoint + stop |
| **stop-stuck** | still stuck after exhausting re-specs → halt rather than grind |

Precedence is deliberate: a verified verdict wins even at the budget edge; a hard
blocker beats a budget stop (surface the actionable thing); ceilings beat stall.
Each pass checkpoints to `.claudemax/state/loop/<slug>.converge.json`.

## Archetype B — standing-loop (`cmax loop add`)

A scheduled, input-driven loop. On every tick it **senses** external state,
**decides** (conservatively) what — if anything — to build, **acts** by running a
converge-loop per item (bounded, deduped, worktree-free for now), and **reports**.

```bash
# Register a loop that watches PRs and addresses review comments, every 15 min:
cmax loop add pr-watch \
  --intent "address review comments on open PRs labeled cmax" \
  --schedule "*/15 * * * *" \
  --source github-prs:label:cmax \
  --max-items 3 --max-credit 10 --per-item-credit 5

# Arm it as a systemd-user timer (or omit --arm to just persist + print the command):
cmax loop add pr-watch ... --arm

# The scheduler invokes this each tick (you can also run it by hand):
cmax loop tick pr-watch
```

**Sources** (`--source`, repeatable):
- `github-prs[:<gh-search-query>]` — open PRs via `gh pr list`
- `github-issues[:<gh-search-query>]` — open issues via `gh issue list`
- `shell:<command>` — each non-empty stdout line becomes a sensed item

**Recurrence** reuses the existing `cmax schedule` substrate (reset-aware
systemd-user timers; dry-fires before arming). `--arm` wires it; without it, `add`
prints the exact `cmax schedule run …` command.

### Guardrails (why a standing fleet is safe)

- **Dedup ledger** — every acted-on item is recorded by a stable key in
  `.claudemax/state/loop/<name>/ledger.json`; the next tick skips anything already
  done. Idempotency is a correctness requirement, not a nicety.
- **Per-tick caps** — `--max-items` and `--max-credit` bound each tick.
- **Fleet budget** — cumulative spend across *all* loops gates new work against the
  same 70/90/95 cost-guard thresholds (`fleetBudgetStatus`). Boris's "dozens of
  loops" is exactly the shape of the documented $47K autonomous-loop runaway, so the
  ceiling is fleet-wide, not just per-run. (Pre-split era: the monthly envelope is
  forward-compat, so the tag stays `ok`; the per-tick caps still bound spend.)
- **Verify-gated** — each item converges through the blind, default-FAIL verify; a
  loop never ships on the executor's own "done."
- **Conservative DECIDE** — triage defaults to *do nothing*; it only acts when the
  intent clearly warrants it.

## Fleet control plane

```bash
cmax loop ls                 # all loops: status, ticks, ledger size, spend + fleet budget
cmax loop status <name>      # spec, run-state, ledger summary, recent ticks
cmax loop pause <name>       # ticks no-op until resumed
cmax loop resume <name>
cmax loop kill <name>        # stop the timer + delete all state
```

## What's built vs. planned

Built (Phases 0–3 of `LOOP_MODE_PLAN.md`): the pure decision machine + types,
the converge-loop runner, the standing-loop engine (sense/decide/act/verify/report)
with live `gh`/shell sense + LLM triage, dedup ledger, fleet budget, and the full
fleet control-plane CLI. All deterministic logic is unit-tested with injected fakes
(no SDK/network needed).

Deliberately **not** done: `cmax ask` is **not** a loop by default — one-shot asks
stay one-shot; loop mode is the separate `cmax loop` surface (the right call per the
plan's §2 verdict). Follow-ups noted in the plan: a `steer.md` between-pass inbox
(pause/resume is the current steering control), worktree isolation per concurrent
item, and folding loop mode into the umbrella for *continuous* work.
