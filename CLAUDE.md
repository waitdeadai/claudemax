# claudemax — repository instructions for Claude

You are working on **claudemax**, an Anthropic-native power-user harness. Spec-driven, model-routed, max-parallel, validated-loop autonomous, independently verified.

## ICP

**Claude Max users** — both Max 5x ($100/mo Agent SDK credit) and Max 20x ($200/mo) are first-class equals. Defaults tuned for Max, not Pro or API-key. If anyone proposes Pro-tier defaults or API-key-first flows, push back.

## Subscription-first auth

All provider calls route through `query()` from `@anthropic-ai/claude-agent-sdk`. The bare `@anthropic-ai/sdk` (which would require `ANTHROPIC_API_KEY`) is **not a dependency**; don't reintroduce it. If you need structured output, use `outputFormat: { type: "json_schema", schema }` via `query()`.

**Billing era (today is 2026-05-28):** Anthropic's split between interactive pool and dedicated Agent SDK credit pool takes effect **2026-06-15**. Today's reality (pre-split era): `cmax ask` consumes the SAME shared 5-hour rolling subscription pool as `claude` REPL. The harness is era-aware — `resolveBillingEra()` in `packages/core/src/cost.ts` auto-resolves by date, override via `CMAX_BILLING_ERA=pre-split|post-split`. Cost-guard 70/90/95% thresholds against `$100/$200 monthly Agent SDK credit` are forward-compat only in pre-split era (`budgetTag` returns `ok` regardless of consumption). Sources: support.claude.com articles 11145838 + 15036540, code.claude.com/docs/en/agent-sdk/overview (accessed 2026-05-21).

## Repository shape

Monorepo with pnpm workspaces:

- `packages/core` — model registry, router, spec + multispec schema, cost (plan-aware), types. Pure TS, no I/O.
- `packages/runtime` — `@anthropic-ai/claude-agent-sdk` `query()` wrappers: orchestrator (Mode A subagents), agent-teams (Mode B), /goal driver, verifier, spec writer, multispec engine, deepresearch, taste, hive, council, agent-factory, overnight, billing.
- `packages/memory` — SQLite+FTS5 store with research_sources, taste_history, sub_specs tables. JSON snapshots. Grounding layer: the `decisions` table carries grounding columns (slug, status, scope, invariant, ttl_days, source_path, tags); a `project_facts` table; read methods (getDecisionBySlug, getFact, staleTruth, searchGrounding) + write helpers (proposeDecision, proposeFact). Staleness reuses `last_verified_at` + `verified_count` (no parallel verified_on column).
- `packages/memory-mcp` — read-only stdio MCP wrapping the memory store's read methods (`{ readonly: true }` handle). Four tools surfaced as `mcp__memory__*` (memory_search / memory_get_decision / memory_get_fact / memory_stale); no `dump_all` by design. Grounds Mode A SDK subagents and Mode B Agent Teams identically.
- `packages/grounding` — `cmax ground migrate|compile|export`: idempotent schema migration + vault→sqlite→CLAUDE.md compile (promote blessed) + sqlite→`vault/_inbox/` export of proposed rows for human review.
- `packages/cli` — `cmax` binary (commander). New v0.2 commands: doctor, taste, overnight, research, config. Grounding: `cmax memory propose-decision|propose-fact` (append `status=proposed`) + `cmax ground migrate|compile|export`.
- `skills/` — Claude Code skill bundle (31 active skills, all on disk; v0.2.1 added `/tdd` + `/harness-audit`; v0.2.2 added `/orchestrate` for multi-goal parallel cmax-ask pipelines; v0.2.3 (2026-05-22) added `/specqa` spec-quality gate ported from minmaxing v1 + `/cc-audit` SOTA-2026 deepresearch-backed audit of upstream Claude Code releases). Trimmed 2026-05-28: the `/workflow` + `/opussonnet` ALIAS-for-/cmax entries (`/workflow` collided with Claude Code's native **Workflow tool**) and the deprecated `/dispatch` stub were removed; the `opussonnet`/`opusolo` model-routing variants remain in the CLI (`cmax run --variant`).
- `.claude/hooks/` — SessionStart, Stop, PostToolUse hooks. `freshness-gate.sh` is a first-party hook referenced DIRECTLY in settings.json (SessionStart + SubagentStop, like `cmax-session-start.sh`), NOT through `dp.sh`; it fail-opens and injects `additionalContext` when a ground-truth invariant is past its verify-by window. `dp.sh` + `soc.sh` are discovery wrappers that locate vendored sibling hooks (`vendor/llm-dark-patterns` / `vendor/searchoclock`; `vendor/` is gitignored, fetched by `setup.sh` + `pnpm dark-patterns:sync` / `searchoclock:sync`). `response-clock` (`plugins/response-clock/hooks/stamp-{start,thinking,firsttool,end}.sh`) is wired DIRECTLY on four events — `UserPromptSubmit` (start `systemMessage`), `MessageDisplay` (prepend `[time]` to the first response chunk via fail-safe `displayContent`), `PreToolUse` (first-tool `additionalContext`, non-blocking), `Stop` (end + elapsed `systemMessage`) — a session-keyed turn clock, no model cooperation; see `docs/response-clock.md`.
- `plugins/` — self-contained, independently distributable Claude Code plugins authored here and dogfooded by the harness. `response-clock` is the first: a zero-dependency QoL turn-clock plugin (passes `claude plugin validate`), submittable to the community marketplace, while its scripts are simultaneously wired into `.claude/settings.json`.
- `.claude/agents/grounded-worker.md` — the worker grounding contract (mirrored as `GROUNDED_WORKER_CONTRACT` in `packages/runtime/src/prompts.ts`, prepended to every sub-Spec leaf spawn). `.claude/agents/searchoclock-{researcher,validator}.md` + `.claude/commands/searchoclock.md` are committed, de-namespaced copies of the searchoclock plugin's agents/command (the vendored hook dispatches them by bare name; see `docs/searchoclock.md`).
- `.mcp.json` — repo-root, committed registration of the first-party `memory` MCP server (project scope; the SDK inherits it via `settingSources`). The one bundled-MCP exception.
- `vault/` — committed Obsidian vault (markdown in git): `decisions/`, `facts/`, `_inbox/`, `_moc/`. Human-canonical truth, compiled into memory + CLAUDE.md.
- `docs/` — architecture, multispec, parallelism, agent-teams, model routing, goal pipeline, workflow variants, skill catalog, taste auto-bootstrap, grounding layer, v1 → v2 migration, quickstart.

## Working rules (apply to changes in this repo)

1. **No new providers.** Anthropic-only by design. If a task wants MiniMax or OpenAI, push back.
2. **Lean catalog.** 31 active skills, no aliases, no deprecated stubs. v0.2.1 added `/tdd` and `/harness-audit`. v0.2.2 added `/orchestrate`. v0.2.3 (2026-05-22) added `/specqa` (spec-quality gate ported from minmaxing v1) and `/cc-audit` (SOTA-2026 audit-before-integrate methodology for new Claude Code releases; catches tweet-bot hallucinations of features that aren't in the official changelog). Trimmed 2026-05-28: removed the `/workflow` + `/opussonnet` ALIAS-for-/cmax entries (`/workflow` collided with the native **Workflow tool**) and the deprecated `/dispatch` stub; the `opussonnet`/`opusolo` model-routing variants remain via `cmax run --variant`. Before adding a new skill, check `docs/SKILL_CATALOG.md` overlap audit checklist AND justify against the existing 31 — `/harness-audit` itself is the long-run forcing function for subtraction.
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
13. **searchoclock closes the `errors_solutions` loop.** The vendored `searchoclock.sh` (`PostToolUseFailure(Bash)` primary + defensive `PostToolUse(Bash)`, wired via `.claude/hooks/soc.sh`) WRITES validated durable fixes into `errors_solutions`; the grounding layer (`grounded-worker` + `mcp__memory__memory_search`) READS them. Its independent validator is Anthropic-only by hard rule: `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER` stays empty; validator = Haiku 4.5, escalate = Sonnet 4.6. The opt-in `PreToolUse(Bash)` preflight stays off by default (`SEARCHOCLOCK_PROACTIVE=0`). `/searchoclock` is a COMMAND, not a catalog skill (doesn't count against the lean skill catalog). See `docs/searchoclock.md`.
13. **Grounding: agents propose, humans bless, compile promotes.** Agents only ever append memory rows with `status='proposed'` (`cmax memory propose-decision|propose-fact`) — they NEVER self-bless. A human flips `blessed: true` in `vault/`; `cmax ground compile` promotes blessed notes → `accepted` rows and compiles `invariant=1` rows into the `GROUNDING:BEGIN … END` managed block of the matching `CLAUDE.md` (the block is written by the compile tool, never hand-edited). The memory MCP is read-only. Staleness is dated via `last_verified_at`/`ttl_days`; the freshness-gate hook surfaces stale invariants as assumptions.

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
