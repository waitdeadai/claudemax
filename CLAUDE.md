# claudemax — repository instructions for Claude

You are working on **claudemax**, an Anthropic-native power-user harness. Spec-driven, model-routed, max-parallel, validated-loop autonomous, independently verified.

## ICP

**Claude Max users** — both Max 5x ($100/mo Agent SDK credit) and Max 20x ($200/mo) are first-class equals. Defaults tuned for Max, not Pro or API-key. If anyone proposes Pro-tier defaults or API-key-first flows, push back.

## Subscription-first auth

All provider calls route through `query()` from `@anthropic-ai/claude-agent-sdk`. The bare `@anthropic-ai/sdk` (which would require `ANTHROPIC_API_KEY`) is **not a dependency**; don't reintroduce it. If you need structured output, use `outputFormat: { type: "json_schema", schema }` via `query()`.

**Billing era (today is 2026-05-22):** Anthropic's split between interactive pool and dedicated Agent SDK credit pool takes effect **2026-06-15**. Today's reality (pre-split era): `cmax ask` consumes the SAME shared 5-hour rolling subscription pool as `claude` REPL. The harness is era-aware — `resolveBillingEra()` in `packages/core/src/cost.ts` auto-resolves by date, override via `CMAX_BILLING_ERA=pre-split|post-split`. Cost-guard 70/90/95% thresholds against `$100/$200 monthly Agent SDK credit` are forward-compat only in pre-split era (`budgetTag` returns `ok` regardless of consumption). Sources: support.claude.com articles 11145838 + 15036540, code.claude.com/docs/en/agent-sdk/overview (accessed 2026-05-21).

## Repository shape

Monorepo with pnpm workspaces:

- `packages/core` — model registry, router, spec + multispec schema, cost (plan-aware), types. Pure TS, no I/O.
- `packages/runtime` — `@anthropic-ai/claude-agent-sdk` `query()` wrappers: orchestrator (Mode A subagents), agent-teams (Mode B), /goal driver, verifier, spec writer, multispec engine, deepresearch, taste, hive, council, agent-factory, overnight, billing.
- `packages/memory` — SQLite+FTS5 store with research_sources, taste_history, sub_specs tables. JSON snapshots.
- `packages/cli` — `cmax` binary (commander). New v0.2 commands: doctor, taste, overnight, research, config.
- `skills/` — Claude Code skill bundle (32 active skills + 1 deprecated stub; v0.2.1 added `/tdd` + `/harness-audit`; v0.2.2 added `/orchestrate` for multi-goal parallel cmax-ask pipelines; v0.2.3 (2026-05-22) added `/specqa` spec-quality gate ported from minmaxing v1 + `/cc-audit` SOTA-2026 deepresearch-backed audit of upstream Claude Code releases). 33 directories total on disk: `/dispatch` is a deprecated stub; `/workflow` + `/opussonnet` are explicit ALIAS-for-/cmax entries kept for v1 muscle memory.
- `.claude/hooks/` — SessionStart, Stop, PostToolUse hooks.
- `docs/` — architecture, multispec, parallelism, agent-teams, model routing, goal pipeline, workflow variants, skill catalog, taste auto-bootstrap, v1 → v2 migration, quickstart.

## Working rules (apply to changes in this repo)

1. **No new providers.** Anthropic-only by design. If a task wants MiniMax or OpenAI, push back.
2. **Lean catalog.** 32 active skills + 1 deprecated stub (`/dispatch`). v0.2.1 added `/tdd` and `/harness-audit`. v0.2.2 added `/orchestrate`. v0.2.3 (2026-05-22) added `/specqa` (spec-quality gate ported from minmaxing v1) and `/cc-audit` (SOTA-2026 audit-before-integrate methodology for new Claude Code releases; catches tweet-bot hallucinations of features that aren't in the official changelog). Two umbrellas (`/workflow`, `/opussonnet`) are explicit ALIAS-for-/cmax entries — router should never pick them on merit. Before adding a new skill, check `docs/SKILL_CATALOG.md` overlap audit checklist AND justify against the existing 32 — `/harness-audit` itself is the long-run forcing function for subtraction.
3. **Router defaults are sacred.** Changing baselines changes the harness's identity. Discuss before editing `packages/core/src/router.ts`.
4. **`/verify` and `/spec` and `/architect` always run on Opus.** Never demote them, even with `--cheap` or past 70/90/95% monthly credit.
5. **Multispec is the default.** Every umbrella auto-runs deepresearch + multispec + parallel /goal + verify. No `--multi` flag. Single-spec mode is an internal engine optimization.
6. **/taste is auto-bootstrap, NOT 10 questions.** Replaces v1's /tastebootstrap. Uses /deepresearch on SOTA at current time. One fallback question only when the repo has no signal.
7. **Two parallelism modes auto-selected.** Mode A (SDK subagents in one query()) for small/short. Mode B (Claude Code Agent Teams with shared task list + worktree isolation) for big multi-day swarms. Override with `--mode {auto|solo|teams}`. Mode B sub-Specs run in a DAG-aware bounded-parallel dispatcher (`packages/runtime/src/agent-teams.ts` post 2026-05-22 fix): independent leaves dispatch concurrently via a `Promise.race(active)` active-set capped by `MAX_PARALLEL_AGENTS` env or `os.cpus().length`; dependency chains serialize; cycle-stuck sub-Specs fail-fast rather than deadlock.
8. **Workers return evidence.** Every packet emits `EVIDENCE:` + `STATUS:` blocks. Dark-patterns hooks block fake aggregator claims.
9. **No comments explaining what.** Code says what. Comments only for non-obvious why.
10. **Plan-aware cost-guard.** 70% → guard (demote non-essential Opus). 90% → danger (aggressive demote). 95% → blocked (`--force` required).
11. **Closeout shape** — when a turn ends partial / blocked / runtime-pending, OPEN the final message with `**Status: partial — <one-line reason>**` (or `Status: blocked` / `Status: runtime-pending` / `Status: paused` / `Status: in-progress` / `Status: unverified`). The `no-vibes.sh` hook recognizes this header in the first 800 chars as a self-declared honest closeout and skips the body scan. Without the header, positive verbs ("done", "ready", "passed", "shipped") anywhere in the message can trigger a block when paired with any failure-shaped phrase. The hook's repair guidance is canonical: `Status: ... / Verification: ... / Next step: ...`. `Status: complete` is INTENTIONALLY not in the allow list — completion claims still need evidence (commands run, tests passed).
12. **`agentcloseout-physics` is the SOTA scorer for closeout hooks.** 19 of 31 dark-pattern hooks delegate to it for ~1ms deterministic scoring (replaces the regex fallback). `setup.sh` installs it via tiered fallback: cargo-binstall → cargo install from git → local clone+build. If missing, hooks still work via bash regex but trigger more false positives.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js doctor          # confirm plan auto-detect
```

## Style

- TypeScript strict, ES modules, NodeNext.
- No default exports except for binary entry points.
- Prefer `readonly` and pure types in `packages/core`.
- Errors thrown from the runtime should include the model id and packet id so failures are diagnosable.
- When calling `query()` with options the SDK types don't yet expose (e.g. `outputFormat`, `effort`, `fallbackModel`, `skills`, `enableFileCheckpointing`, `agentProgressSummaries`, `forwardSubagentText`, `settingSources`), use `as never` cast on the options object. These are documented in `code.claude.com/docs/en/agent-sdk/typescript` and supported at runtime even when types are stale.

## Memory entries (deferred-write reminders)

Already saved in `/home/fer/.claude/projects/-home-fer-Documents-minmaxingv2/memory/`:
- feedback-north-star (multispec pipeline as flagship)
- feedback-fat-umbrellas (umbrellas auto-run full pipeline)
- feedback-two-parallelism-modes (Mode A/B auto-select)
- feedback-skill-catalog (lean 29 active + 1 deprecated stub; audited)
- feedback-taste-autobootstrap (no 10 questions)
- feedback-icp-claude-max (Max 5x and Max 20x first-class)
- feedback-goal-validated (wrap Claude Code's native /goal, don't reimplement)
- feedback-anthropic-only (hard rule)
- project-claudemax (what this dir actually is)
