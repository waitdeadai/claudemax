# claudemax Operator Guide — the Boris method, SOTA-2026

> How to actually operate claudemax to get **truly effective** results — not just
> autonomous ones. This guide reverse-engineers the working method of **Boris Cherny**
> (creator of Claude Code) and grounds it in independently-sourced 2026 best practice.
> Full citations + confidence tiers live in [`LOOP_MODE_PLAN.md`](./LOOP_MODE_PLAN.md);
> the loop-mode reference is [`LOOP_MODE.md`](./LOOP_MODE.md).
>
> Last researched: 2026-06-08 (live, primary transcripts + 20+ sources).

---

## TL;DR — the one thing that matters

> **"The most important thing to get great results out of Claude Code — give Claude a
> way to verify its work. If Claude has that feedback loop, it will 2-3x the quality
> of the final result."**
> — Boris Cherny, [howborisusesclaudecode.com](https://howborisusesclaudecode.com/)

claudemax bakes that verification loop in by default: every autonomous run ends with a
**blind Opus verify** that re-reads the repo and re-checks each completion condition,
and **nothing is declared done on the executor's own claim**. That is the 2-3x lever,
on by default. Your job as operator is to **design and steer loops**, not to prompt
each step:

> **"I don't prompt Claude anymore. I have loops that are running… My job is to write
> loops."** — Boris Cherny, Acquired Unplugged ([RkQQ7WEor7w](https://www.youtube.com/watch?v=RkQQ7WEor7w))

Three commands cover almost everything:

| Goal | Command |
|---|---|
| Build something effective, looped to a verified DONE | `cmax loop run "<goal>"` |
| One-shot effective build (no outer loop) | `cmax ask "<goal>"` |
| Standing, recurring, input-driven autonomy | `cmax loop add <name> …` |

---

## The method in one paragraph

Boris's leverage moved `code → prompts → loops`. He runs ~5–10 interactive Claude Code
sessions by day and **"a few thousand"** sub-agents overnight (verbatim, Sequoia AI
Ascent 2026), steers dozens of PRs/day from his phone, and codifies recurring work as
**skills wired into loops** (`/loop 5m /babysit`, `/loop 30m /slack-feedback`, …). What
makes it *effective* rather than just busy: (1) every loop has a **verification path**,
(2) each loop is **narrowly scoped** to one action class, (3) `CLAUDE.md` holds the
shared, committed context so loops don't drift, and (4) the human stays **on** the loop
(approve plans, review PRs, audit the verifiers) rather than **in** it. claudemax turns
that method into first-class commands with the verify gate, dedup, and budget guards
built in.

---

## Layer 1 — `cmax loop run`: the effective-build loop (your daily driver)

This loops your full `cmax` pipeline to a verified DONE:

```
CONSTRUCT (once): /deepresearch → multispec decompose
   └─ ITERATE (each pass, fresh context): parallel /goal over unfinished sub-Specs
        └─ VERIFY: blind Opus rollup verify  ← the source of truth, never demoted
             └─ DECIDE: continue ▸ re-decompose on stall (respec) ▸ stop at budget ▸ done
```

```bash
cmax loop run "migrate the auth layer to passkeys with passing e2e tests"
cmax loop run "<goal>" --max-passes 6 --max-credit 80         # let it grind longer
cmax loop run "<goal>" --ssc --adversarial                    # hardened spec + adversarial verify
cmax loop run "<goal>" --opusolo                              # Opus executes too (highest ceiling)
cmax loop run "small, well-defined change" --lean             # cheap single-spec spec→goal→verify
```

**Operator notes**
- It only declares `done` when the blind verify passes every condition. If it can't
  converge inside the budget it stops honestly (`stop-max` / `stop-budget`) at the best
  partial — give real goals more passes/credit (defaults: 4 passes, $60).
- After two stalled passes it **re-decomposes** (the spec was probably wrong) instead of
  grinding — this mirrors the house rule "if two iterations don't move it, re-spec."
- Use `--lean` when the goal is one well-defined change that doesn't need deepresearch or
  decomposition.

When to use `cmax ask` instead: a single deterministic pass with no outer loop (faster,
cheaper, no respec). `cmax ask` is intentionally **not** a loop.

---

## Layer 2 — `cmax loop add`: standing loops (the Boris fleet pattern)

A scheduled, input-driven loop. Each tick **senses** external state, **decides**
(conservatively) what to build, **acts** by running the full pipeline per item (deduped,
budget-bounded), and **reports**.

```bash
# Watch your open PRs; build fixes for review comments / failing CI, every 15 min:
cmax loop add pr-watch \
  --intent "address review comments and fix failing CI on my open PRs" \
  --schedule "*/15 * * * *" \
  --source github-prs:"is:open author:@me" \
  --max-items 3 --max-credit 10 --per-item-credit 5 --arm

# Turn triaged issues into PRs every hour:
cmax loop add issue-bot \
  --intent "implement small, well-scoped issues labeled 'cmax-auto' with tests" \
  --schedule "0 * * * *" \
  --source github-issues:"label:cmax-auto" \
  --max-items 2 --per-item-credit 8 --arm

# Generic: any command whose stdout lines are work items:
cmax loop add backlog --intent "clear the backlog file" --schedule "0 9 * * *" \
  --source shell:"cat backlog.txt"
```

Fleet control plane:

```bash
cmax loop ls                 # status, ticks, ledger size, spend + the fleet budget
cmax loop status <name>      # spec, run-state, ledger, recent ticks
cmax loop pause/resume <name>
cmax loop tick <name>        # run one tick by hand (also what the schedule invokes)
cmax loop kill <name>        # stop the timer + delete all state
```

**Built-in guardrails** (because "dozens of loops" is the shape of the documented $47K
runaway):
- **Dedup ledger** — each acted-on item is recorded; the next tick skips it. No re-shipping.
- **Per-tick caps** (`--max-items`, `--max-credit`) and a **fleet budget** that gates new
  work against the 70/90/95 cost-guard across *all* loops.
- **Verify-gated** — each item converges through the blind rollup verify; never ships on a
  self-claim.
- **Conservative DECIDE** — triage defaults to *do nothing* unless action is clearly warranted.

> **Light ops vs. effective builds.** For *light* recurring chores (rebasing, Slack
> digests, closing stale PRs) Boris's own tools — native Claude Code **`/loop`** +
> **`/schedule`** with a small custom skill — are cheaper and perfect. Reach for
> `cmax loop add` when each item is real *build* work that deserves the full
> deepresearch → decompose → verify pipeline. Use the right weight for the job.

---

## Layer 3 — the operator's daily routine (adapted from Boris's, SOTA-2026)

**Morning (15–30 min)**
1. Triage overnight: `cmax loop ls` + `cmax loop status <name>` — completed PRs, blocked
   items, budget spent. Review/merge what's green from your phone.
2. Kick off the day's interactive builds: a `cmax loop run "<goal>"` per focused goal you
   want shipped today. Define "done" in one unambiguous sentence first.
3. Confirm standing loops are healthy and not conflicting (stagger schedules — see below).

**During the day (continuous)**
4. **Plan before auto-accept.** For interactive Claude Code work, start in Plan Mode
   (Shift+Tab twice), get the plan right, then let it run. Human judgment at plan time is
   far cheaper than cleaning up a wrong plan that ran to completion.
5. **Verify-first for every task.** If a goal's "done" isn't mechanically checkable, fix the
   spec — claudemax's `/specqa` gate enforces this. The verify loop is the multiplier.
6. **Review PRs, not diffs-line-by-line.** Batch by scope; intervene only where
   architectural judgment is needed. Let the blind verify + CI be the first gate.
7. **Keep `CLAUDE.md` current.** Every new convention/invariant you discover → commit it.
   This is the shared memory that keeps many concurrent sessions and loops from drifting.

**Evening (10–20 min)**
8. Launch the deeper/longer build as a budget-bounded run:
   `cmax loop run "<bigger goal>" --max-passes 8 --max-credit 120` (or `cmax overnight`
   for checkpoint/resume across a rate-limit window).
9. Set explicit stop conditions and confirm the budget before you walk away. Never let an
   overnight run go unbounded — the ceilings are mandatory, not optional.

**Weekly (30–60 min) — loop hygiene**
10. Audit active loops: still useful? conflicting? drifting? `cmax loop ls`.
11. Anything you prompted by hand 3+ times → codify it as a `.claude/commands/` skill, then
    wire it into a `cmax loop add` or a native `/loop`.
12. Update `CLAUDE.md` with the new skills/conventions.

**Discard discipline (continuous)**
- Expect to discard ~10–20% of sessions that yield no progress — that's normal. Don't debug
  a stuck session for more than a few minutes; kill it and relaunch with **tighter scope**.
  If an agent keeps getting stuck, the task is under-specified, not the model under-powered.

---

## What makes loops effective (the principles)

1. **Verification is the multiplier (2-3x).** A loop without a self-verification path is
   autonomous drift. claudemax's blind, decomposed, default-FAIL verify is that path, on by
   default. *"The agentic engineer's job is no longer to check the code. It is to check the
   system that checks the code."* ([arize.com](https://arize.com/blog/closing-the-loop-coding-agents-telemetry-and-the-path-to-self-improving-software/))
2. **The loop is a product, not a prompt.** Design it once: trigger + scope + action budget +
   stop condition + reporting path. ([addyosmani.com/blog/loop-engineering](https://addyosmani.com/blog/loop-engineering/))
3. **Scope isolation prevents conflict.** One loop, one action class, one feedback signal.
   Overlapping loops compete (Boris's documented babysit-vs-pruner conflict) — stagger their
   schedules and keep their operations non-overlapping.
4. **`CLAUDE.md` is the shared memory.** It's re-injected every request and never compacted
   away — persistent rules belong there, not in a one-off prompt.
5. **Skills are reusable loop atoms.** Repeating workflow → skill → loop.
6. **Human on the loop, not in it.** Approve plans, review PRs, audit verifiers/stop
   conditions. Anthropic's own engineers keep active oversight on 80–100% of tasks; full
   autonomy is the exception, reserved for unambiguous, well-verified work
   ([swarmia.com five levels of autonomy](https://www.swarmia.com/blog/five-levels-ai-agent-autonomy/)).

## Cost & safety discipline

- **Bound every autonomous run.** `--max-credit` / `--max-passes` on `cmax loop run`;
  `--max-credit` / `--per-item-credit` / `--max-items` on standing loops; `--budget-credits`
  on `cmax overnight`. The defaults are non-infinite by design.
- **Fleet budget gate.** `cmax loop ls` shows cumulative spend and the 70/90/95 tag; a
  `blocked` fleet tag stops new ACT. (Pre-split era until 2026-06-15: the monthly envelope is
  forward-compat, so the tag stays `ok`; the per-run caps still bound spend.)
- **Right model for the job.** Sonnet executes sub-Specs by default; Opus plans/verifies and
  never gets demoted off verify/spec; `--opusolo` raises the execution ceiling when the
  domain warrants it (auth, payments, novel work). Long large-context overnight runs can cost
  real money — justify them before launching.

---

## Mapping: Boris's tools ↔ claudemax

| Boris does… | In claudemax / Claude Code |
|---|---|
| `/loop 5m /babysit` (light PR ops) | native `/loop` + a `.claude/commands/` skill (cheap) |
| Effective build/refactor, looped | `cmax loop run "<goal>"` (verify-gated, respec-on-stall) |
| Standing input-driven fleet | `cmax loop add` + `cmax schedule` (dedup + fleet budget) |
| "a few thousand overnight" deep work | `cmax loop run --max-passes/--max-credit` or `cmax overnight` (checkpoint/resume) |
| Verification = the 2-3x lever | blind Opus `/verify`, on by default; never self-graded |
| `CLAUDE.md` as shared memory | same — committed, re-injected each session |
| Plan mode → auto-accept | same native Claude Code workflow |
| Review dozens of PRs from phone | review claudemax-produced PRs; the blind verify is your first gate |

---

## Further reading & sourcing

- [`LOOP_MODE.md`](./LOOP_MODE.md) — loop-mode command reference.
- [`LOOP_MODE_PLAN.md`](./LOOP_MODE_PLAN.md) — design rationale + **full primary-source
  citations and confidence tiers** for every Boris claim referenced here.
- Primary: Boris Cherny — Acquired Unplugged ([RkQQ7WEor7w](https://www.youtube.com/watch?v=RkQQ7WEor7w)),
  Sequoia AI Ascent 2026 ([SlGRN8jh2RI](https://www.youtube.com/watch?v=SlGRN8jh2RI)),
  [howborisusesclaudecode.com](https://howborisusesclaudecode.com/), his Threads `/loop` posts.
- SOTA-2026: Addy Osmani (loop engineering), Swarmia (five levels of autonomy), Arize (closing
  the loop), Anthropic Engineering (effective harnesses for long-running agents), o-mega.ai
  (long-running coding agents).

> Confidence note: Boris's concrete cadences and the verification quote are HIGH-confidence
> (verbatim, multi-sourced). The "couple hundred agents reading GitHub/Slack/Twitter" framing
> is a summarizer's paraphrase (LOW-MEDIUM) — the defensible claim is that he runs loops that
> continuously read GitHub/Slack/CI as input signals.
