# Loop Mode — design plan & living spec

> **Status: Phases 0–3 BUILT (2026-06-08), verify-gated by build + typecheck + 28
> passing loop tests.** See [`LOOP_MODE.md`](./LOOP_MODE.md) for the user guide.
> Code: `packages/core/src/loop.ts` (pure decision machine + tests),
> `packages/runtime/src/{loop,loop-ledger,loop-budget,standing-loop}.ts`,
> `packages/cli/src/commands/loop.ts` (`cmax loop`). Phases 4–5 (daemonized
> headless scheduler, fold-into-umbrella) remain proposed. Original plan below.
>
> Deepresearch-backed plan for a first-class
> "loop everything" mode in claudemax. Produced 2026-06-08 via /deepresearch
> (3 parallel web collectors + a primary-source verification pass + read-only repo
> gap analysis). Sources cited inline. Nothing here is implemented until the
> direction is blessed.
>
> Origin: user asked to extract what **Boris Cherny** (creator of Claude Code) meant
> by "the importance of loops" in his daily work, then plan a paradigm where —
> instead of reaching for `cmax` / `goal` / `wf` — *the loop is the unit of work*.

---

## 0. Source-confidence preamble (read this first)

The user said: *don't take my framing as source of truth, deepresearch everything.*
Same rigor applies to our own findings.

**On the Boris talk — HIGH confidence: PRIMARY transcripts reached.** Both source
videos' caption tracks were pulled directly (yt-dlp auto-captions, 2026-06-08) and
the loop quotes confirmed verbatim — not from secondary recaps. Caveat: these are
*auto-generated ASR captions*, so minor transcription noise is possible; they are
primary (from the videos themselves) but not an official published transcript.

Confirmed verbatim lines:

> *"I don't prompt Claude anymore. I have loops that are running… My job is to write
> loops."* — Acquired Unplugged (YouTube `RkQQ7WEor7w`, WorkOS channel, up. 2026-06-02)

> *"You have Claude use cron to schedule a job… it's a repeat job… I have like dozens
> of loops running… loops are the future."* — Sequoia AI Ascent 2026 (YouTube
> `SlGRN8jh2RI`, Sequoia channel, up. 2026-05-04)

> *"We have no more manually written code anywhere at the company."* — Sequoia, ibid.

Two events, ~3 weeks apart, deliver the same arc:
- **Acquired "Unplugged," presented by WorkOS** — YouTube `RkQQ7WEor7w`. Source of
  the "I don't prompt anymore / my job is to write loops" line.
- **Sequoia AI Ascent 2026** (w/ Lauren Reeder) — YouTube `SlGRN8jh2RI` ("Why Coding
  Is Solved, and What Comes Next") + `8FVlxgG9JVk`. Source of the concrete
  `/loop` + cron mechanics and "loops are the future."
- **YC "Lightcone" (~Feb 17 2026)** — earlier, *pre-loops*; the user's "Y Combinator"
  memory is a plausible conflation.

**Confidence tiers:**
- HIGH: the thesis ("I write loops, not prompts"); loops = native `/loop` + cron;
  dozens of loops + hundreds of agents reading GitHub/Slack/Twitter; phone-driven;
  IDE uninstalled. (Direct quote + 3-source corroboration.)
- MEDIUM: exact cron intervals. Boris said "every minute, every five minutes, every
  day, however often." The specific worked intervals in some writeups
  (15-min PR babysitting, 30-min feedback clustering) are *author examples/inference*,
  not verified Boris numbers.
- DONE: primary transcript verification — both videos' caption tracks pulled via
  yt-dlp and quotes confirmed verbatim (auto-ASR, see caveat above).

---

## 1. What Boris actually meant (verified — and it corrects our first draft)

The first draft of this doc read "loops" as the *converge-on-one-spec feedback
loop* (Ralph-style). **That was too narrow.** The verified meaning is broader and
more literal:

**"Loops" = standing, scheduled, input-driven, autonomous agent jobs.** Concretely:

1. **Standing & scheduled, not one-shot.** Literally the native Claude Code `/loop`
   command backed by **cron** — "the simplest thing that works." Jobs recur every
   minute / 5 min / day. He runs **dozens concurrently**.
2. **Input-driven.** The loops **read external state** — GitHub issues/PRs, Slack,
   Twitter/X, CI — and **decide whether action is needed and what to build**.
   "Hundreds of Claude instances monitoring Twitter feedback, GitHub issues, and
   Slack to generate product ideas."
3. **Bounded autonomy + report.** The operating shape (per practitioner analysis):
   *inspect state → decide if action needed → act within a defined scope → report*,
   with bounded action budgets, escalation rules, and ownership isolation to avoid
   races.
4. **Human on-the-loop, from anywhere.** He *steers* dozens of loops and ships
   dozens of PRs/day **from his phone**. He stopped firing one-shot prompts; the
   loops do the prompting. The leverage moved `code → prompts → loops`.
5. **It's a productivity regime, not a trick.** +200% merges/engineer/day at
   Anthropic; >90% of the Claude Code team's code written by Claude Code;
   onboarding weeks → ~2 days.

So "loop everything" (the user's words) means: **stop firing discrete `cmax ask`
commands; instead register standing loops that watch inputs, decide, and ship —
orchestrating the existing claudemax pipeline as each loop's action body, with the
human steering the fleet rather than babysitting runs.**

The converge-on-a-spec validated loop (our first draft) is *not wrong* — it's the
**action body of a single loop iteration**. The headline paradigm is the **standing
loop fleet** on top of it.

---

## 2. The judgment you delegated: "is it worth it?"

You said: *loop-core re-architect if it's worth it; loop-by-default if worth it, else
a separate command; best of both worlds on interactive vs headless.* Here is the
evidence-backed verdict.

**Verdict: YES to loop as a new first-class top-layer primitive. NO to ripping out
or replacing cmax/goal/multispec. NO to making one-shot `cmax ask` a loop by
default.** Reasoning:

- **Worth it — loop as a new top layer.** Boris *literally stopped* using one-shot
  prompting; his entire workflow is standing loops. If the goal is to embody that
  paradigm, the loop must be a **standing, scheduled, first-class orchestration
  primitive**, not an optional wrapper you invoke once. This is the "re-architect"
  you asked about — but it's **loop-as-new-top-layer, not loop-replaces-everything.**
  The loop *contains* cmax/goal/multispec as its action body.
- **Not worth it — loop-by-default on `cmax ask`.** Many asks are genuinely one-shot
  ("fix this bug now"). Forcing every ask into a standing/recurring loop adds
  latency, cost, and scheduling overhead for no benefit, and risks the runaway-spend
  failure mode (§9). Boris's loops are for *continuous* work (watch PRs, cluster
  feedback, monitor CI, generate ideas) — not for every discrete edit.
- **Therefore: a separate first-class command** (your fallback option) — `cmax loop`
  — is the right surface. `cmax ask` stays the one-shot daily driver; `cmax loop`
  is the standing-loop layer. "Default shape" applies to **continuous** work, which
  becomes loop-first.
- **Best of both worlds (your variant answer) falls out naturally.** A standing loop
  is inherently *headless + scheduled* (cron) for execution, AND *interactively
  steerable* (phone / steer inbox) for the human-on-the-loop. Both, by construction
  — exactly Boris's "dozens of loops + steer from phone."

This keeps every CLAUDE.md rule intact: no new providers (GitHub/Slack/Twitter are
*data inputs*, not model providers); router defaults untouched; verify/spec stay on
Opus; lean catalog honored (no colliding `/loop` skill — §5).

---

## 3. SOTA-2026 loop principles (the rubric any design must satisfy)

From the deepresearch brief (sources at end).

| # | Principle | confidence |
|---|---|---|
| P1 | **Closeable objective signal** is the spine (tests > typecheck > lint > build > endpoint-200). LLM-as-judge is "less robust," secondary only. | high |
| P2 | **Generator ≠ verifier.** Separate model / external signal checks completion; same-model self-grading prefers its own output. | high |
| P3 | **Fresh context per iteration** beats one long session (context rot ~65–85% capacity). Ralph loop: clean context against persistent on-disk state. | high (rot) |
| P4 | **Hard termination contract.** DONE / BLOCKED / MAX_ITERS / TOKEN_BUDGET. SDK enforces *none* by default. ($47K LangChain runaway, Nov 2025.) | high |
| P5 | **Stall detection ≠ termination.** STUCK (degeneration, verifier stall, mode collapse) needs its own detector vs. DONE/BLOCKED progress exits. | high |
| P6 | **Stop-hook as enforcer** can block premature "done" — with an 8-consecutive-block ceiling + `stop_hook_active` guard. | high |
| P7 | **Checkpoint + resume mandatory.** `session_id` returned on every result subtype; `enableFileCheckpointing`. | high |
| P8 | **Escalation discipline.** ReAct → reflection on repeat-fail → re-anchor at ~40 steps → verifier-critic → multi-agent only when capped. | med-high |
| P9 | **Standing-loop-specific:** bounded scope per run, ownership/worktree isolation to avoid races between concurrent loops, idempotent triggers, dedup so a loop doesn't re-do work it already shipped. | high |

claudemax already satisfies P1/P2/P6/P7 inside `goal.ts` / `verify.ts` /
`verdict-artifact.ts` / `overnight.ts`. The new work is **P3 + P4 + P5 + P9 as a
first-class standing-loop driver** with a trigger layer.

---

## 4. Current-state map — claudemax is ~75% there (verified by repo read)

| Loop ingredient | Where it lives today | Gap |
|---|---|---|
| **Scheduling / cron** | native `/loop`; `packages/runtime/src/scheduler.ts`; `docs/RESUMABLE_CRON.md`; `cmax schedule` (`commands/schedule.ts`) | Not wired to drive the cmax pipeline as a recurring loop body; no trigger/decide layer |
| **Validated loop** (advance→verify→iterate) | `goal.ts` (turn cap, adaptive thinking, dark-pattern Stop hooks deliberately not loaded so tone hooks can't block termination) | Single-session, not fresh-context outer loop; no explicit DONE/BLOCKED/STUCK machine |
| **Independent verifier** (P1/P2) | `verify.ts`, `mutation-verify.ts`, `interactive-verify.ts`, `verdict-artifact.ts` (`.claudemax/state/verdict-<hash>.json`, default-FAIL, evidence-as-file) | Verdict artifact = ideal loop feedback signal; underused as a *driver input* |
| **Spec gate** (the loop's CONSTRUCT) | `multispec.ts`, `spec-writer.ts`, `ssc.ts`, `specqa`, `introspect` | Ready; becomes per-loop "decide what to build" |
| **Long-run checkpoint/resume** (P7) | `overnight.ts`, `resumable.ts`, `mega.ts` + `resume.ts` (lane checkpoint, saturation pause/resume) | Per-mode; not unified under a loop abstraction |
| **Budget / cost-guard** (P4) | `billing.ts`, `saturation.ts`, cost-guard 70/90/95; deterministic maxTurns in `goal.ts` | Enforced per-run; **no fleet-level budget** across many standing loops |
| **Parallel fan-out** | `orchestrator.ts`/`orchestrator-multi.ts` (Mode A), `agent-teams.ts` (Mode B), `concurrency.ts`, `hardware.ts`, native Workflow tool | The body of a loop's action; "hundreds of agents" needs fleet accounting |
| **Inbox/trigger inputs** | MCP servers available (waitdead-crm, Gmail, Calendar); `gh` CLI | **No GitHub/Slack/Twitter trigger layer** that feeds loops |
| **Honesty/stall gates** (P5/P6) | `cmax-stop.sh`, `cmax-verdict-gate.sh`, `cmax-stub-gate.sh`, dark-patterns, `no-vibes.sh` | Honesty tells yes; *progress* stall detection no |
| **Effectiveness theory** | `docs/EFFECTIVENESS_OS.md` (proxy↔intent gap; SSC + decomposed verify + completion gate) | The loop-quality theory; loop mode operationalizes it as a standing runner |

**Headline:** claudemax has the loop *body* and the *scheduler primitives*. The
missing layer is a **trigger → decide → run-pipeline → verify → report → reschedule
driver** plus **fleet-level budget/observability** for many concurrent standing loops.

---

## 5. Naming / collision constraint (decided)

**No new `/loop` skill.** Claude Code ships native `/loop` (cron/ScheduleWakeup).
A claudemax `/loop` skill repeats the `/workflow`-collision mistake (removed
2026-05-28). Surface as:
- **`cmax loop`** — the standing-loop layer (CLI).
- Reuse/extend **`cmax schedule`** for the cron registration underneath.
- No new catalog skill unless it earns its place vs. the lean 31 (rule 2); document
  loop mode in QUICKSTART + a `docs/LOOP_MODE.md` user guide instead.

---

## 6. The Loop paradigm (redefined around the verified meaning)

Two loop archetypes. claudemax should support both; Boris's headline is **B**.

### Archetype A — Converge-loop (finite: drive one goal to DONE)
The validated loop made first-class. State machine over an on-disk workspace
(`.claudemax/state/loop/<slug>/`):

```
CONSTRUCT (deepresearch→multispec→specqa→introspect)  →  writes SPEC + DAG
   │
   ▼  (fresh-context each pass — P3)
ITERATE  parallel /goal advance (one bounded advance)  →  evidence to disk
   │
   ▼
VERIFY   per-condition blind Opus → verdict-<hash>.json (default-FAIL)
   │
   ▼  DECIDE
DONE | BLOCKED | CONTINUE | STUCK | RESPEC(2×STUCK→re-CONSTRUCT) | BUDGET/MAX
```

### Archetype B — Standing-loop (the Boris pattern: recurring, input-driven)
A scheduled job (cron via `cmax schedule`/native `/loop`) whose body is:

```
            ┌─────────────── every cron tick ───────────────┐
            ▼                                                │
SENSE   read inputs (gh PRs/issues, Slack, Twitter, CI,      │
        repo state) via MCP/gh — the loop's "inbox"          │
            │                                                │
            ▼                                                │
DECIDE  is action needed? what to build? (cheap triage:      │
        Haiku/Sonnet) → emit 0..N bounded work-items;        │
        DEDUP against an on-disk ledger of already-shipped    │
            │                                                │
            ▼                                                │
ACT     for each work-item: run Archetype-A converge-loop    │
        (bounded scope, worktree isolation) as the body      │
            │                                                │
            ▼                                                │
VERIFY  blind verify each item (default-FAIL)                │
            │                                                │
            ▼                                                │
REPORT  PR / notify (ntfy/phone) + write to ledger; honor    │
        steer.md; respect fleet budget; then ──reschedule────┘
```

Key properties (map 1:1 to the verified Boris setup):
- **Idempotent + dedup'd** — a loop must not re-ship work it already did (ledger).
- **Bounded scope per tick** — max items, max files, max budget per run (P4/P9).
- **Ownership isolation** — worktree-per-item so concurrent loops don't race (P9).
- **Fleet budget** — a global cost-guard across *all* standing loops, not just per
  run (the dozens-of-loops reality makes this non-negotiable — §9).
- **Steerable** — `steer.md` inbox + `cmax loop status`; notify to phone (ntfy,
  already in claudemax's remote stack — `docs/REMOTE_OPERATION.md`).

---

## 7. Proposed build (phased; each phase independently shippable)

> Wraps existing machinery; does **not** touch router defaults (rule 3) or demote
> verify/spec (rule 4). Loop body = the existing default pipeline.

**Phase 0 — Contract & state machine (no behavior change).**
- `packages/core`: `LoopState`, `LoopAction`, `LoopLedger`, `StandingLoopSpec` types.
- `packages/runtime/src/loop.ts`: pure `decide(verdict, ledger, budget) → LoopAction`
  (unit-tested, no I/O) — the Archetype-A brain.

**Phase 1 — `cmax loop` converge-mode (Archetype A, interactive).**
- `packages/cli/src/commands/loop.ts` → `cmax loop "<goal>"`.
- CONSTRUCT→ITERATE→VERIFY→DECIDE with the §6A contract; fresh-context passes;
  checkpoint every pass; `--resume`. Self-pace across turns via ScheduleWakeup.

**Phase 2 — Standing-loop engine (Archetype B, the Boris paradigm).**
- SENSE adapters: `gh` (PRs/issues/CI), Slack, Twitter/X, repo-state — start with
  `gh` (zero new deps), add others behind flags. Reuse available MCP servers.
- DECIDE triage (cheap tier) + on-disk dedup ledger.
- ACT = invoke Phase-1 converge-loop per work-item, worktree-isolated.
- Schedule via `cmax schedule`/cron; REPORT via PR + ntfy.

**Phase 3 — Fleet control plane.**
- `cmax loop ls / status / pause / resume / kill` across all standing loops.
- **Fleet-level budget** + cost-guard integration (70/90/95 across the fleet).
- `steer.md` honored per loop; per-loop + fleet observability (response-clock,
  `agentProgressSummaries`, `memory.runs`).

**Phase 4 — Headless / unattended + remote.**
- Daemonized scheduler (systemd timer / cron) for true standing operation; resume
  across rate-limit windows (reuse `resume.ts` + saturation pause).
- Phone steering loop (ntfy + Tailscale, already in `docs/REMOTE_OPERATION.md`).

**Phase 5 — Make it the default *for continuous work* (not for one-shot asks).**
- Document the regime shift in QUICKSTART; `/harness-audit` decides what (if
  anything) gets subtracted now that the loop is the top layer.

---

## 8. The "loop everything" end-state

- One-shot work: `cmax ask "<goal>"` — unchanged.
- Continuous work: `cmax loop add "<watch+build intent>"` — a standing, scheduled,
  input-driven loop that senses, decides, runs the full pipeline per item, verifies
  blind, ships a PR, reports to your phone, and reschedules. Run dozens; steer the
  fleet, don't babysit runs. `cmax`/`goal`/Workflow become **loop bodies**:
  `goal` = one ITERATE advance; multispec = the DECIDE/CONSTRUCT; the Workflow tool
  = a fan-out inside an ACT.

---

## 9. Risks & anti-patterns (standing loops raise the stakes)

- **Runaway fleet spend** — the single biggest risk. Dozens of standing loops ×
  hundreds of agents = the $47K-postmortem failure mode at scale. **Mandatory
  fleet-level budget + per-loop caps + cost-guard 70/90/95 at the DECIDE gate.**
  Never ship Archetype B without non-infinite `--max-items`, `--budget-credits`,
  and a global fleet ceiling.
- **Duplicate / thrashing work** — without a dedup ledger, recurring loops re-ship
  the same change. Idempotency is a correctness requirement, not a nicety.
- **Races between concurrent loops** — worktree/ownership isolation (P9) is required.
- **Verifier stall / self-grading** — keep generator≠verifier, default-FAIL,
  per-condition verify, stall detection.
- **Non-termination via honesty hooks** — preserve the `goal.ts` separation:
  termination is decided by the *verdict artifact*, not tone hooks.
- **Trigger noise** — input-driven loops can over-fire on noisy Twitter/Slack;
  DECIDE triage must be cheap and conservative (do-nothing is the default action).
- **Over-engineering** — start at ReAct-simple (P8); converge-loop (Phase 1) before
  the standing fleet (Phase 2).

---

## 10. Forks — reconciled with your answers

| Fork | Your answer | Resolved plan (this doc) |
|---|---|---|
| Wrap vs re-architect | "loop-core re-architect if worth it" | **Loop = new first-class top layer** containing cmax/goal as body. Re-architect the *entry paradigm*, not the engine. (§2) |
| Default vs opt-in | "loop by default if worth it, else separate command" | **Separate command `cmax loop`.** One-shot `cmax ask` stays. Loop is default *for continuous work only*. (§2) |
| Interactive vs headless | "best of both worlds" | **Both by construction:** scheduled/headless execution + interactive steering (steer.md + phone). (§6B) |
| Skill surface | (implied) | **No new `/loop` skill** (native collision). `cmax loop` + extend `cmax schedule`. (§5) |

**Recommended next steps after this doc is blessed:** (1) finish the verbatim
transcript verification pass (in flight) and pin the exact quotes; (2) build Phase 0
(pure state machine, no behavior change) for review; (3) prototype one Archetype-B
`gh`-triggered loop end-to-end on a throwaway goal to validate the SENSE→DECIDE→ACT
→VERIFY→REPORT cycle and the fleet-budget guard before scaling.

---

## 11. Source index (deepresearch 2026-06-08)

**Boris — primary-anchored:** Acquired Unplugged (YouTube `RkQQ7WEor7w`); Sequoia AI
Ascent 2026 (YouTube `SlGRN8jh2RI`, `8FVlxgG9JVk`); officechai.com 2026-06-06
(direct quote); workos.com 2026-06-02 (takeaways + metrics); developersdigest.tech
2026-05-05 (loop mechanics analysis); digg.com; threads/@bruceqburke; X/@Av1dlive
(setup description); Lauren Reeder + Alex Alexiuc LinkedIn (venue corroboration);
howborisusesclaudecode.com. (Primary transcripts confirmed via yt-dlp auto-captions
2026-06-08: `RkQQ7WEor7w`, `SlGRN8jh2RI`.)

**SOTA loop patterns:** code.claude.com/docs/en/agent-sdk/agent-loop +
/hooks + /sessions + /subagents + /typescript + /best-practices;
code.claude.com/docs/en/scheduled-tasks (`/loop`, cron) + /routines;
claude.com/blog/building-agents-with-the-claude-agent-sdk; ralphable.com (Ralph
loop); digitalapplied.com (pattern taxonomy 2026); dev.to/gabrielanhaia (patterns;
$47K postmortem Nov 2025); ceaksan.com (8 failure modes); o-mega.ai (long-running
agents 2026); claudefa.st (Stop-hook enforcer); fixbrokenaiapps.com (stall
detection); arXiv 2401.08500 (AlphaCodium), 2510.23761 (TDFlow), 2411.13768 (EDD);
thoughtworks.com (cybernetics / human-on-the-loop); SWE-agent NeurIPS 2024.

**Repo (verified read 2026-06-08):** goal.ts, verify.ts, verdict-artifact.ts,
overnight.ts, mega.ts, resume.ts, multispec.ts, ssc.ts, billing.ts, saturation.ts,
scheduler.ts, concurrency.ts, hardware.ts, orchestrator(-multi).ts, agent-teams.ts;
commands/{schedule,resume,overnight,mega}.ts; docs/EFFECTIVENESS_OS.md, SOTA_2026.md,
RESUMABLE_CRON.md, REMOTE_OPERATION.md.
