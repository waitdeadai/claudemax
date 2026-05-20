# Changelog

All notable changes to claudemax. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — 2026-05-20

Major rewrite: Anthropic-only, multispec engine as the default daily-driver, two parallelism modes (SDK subagents + Claude Code Agent Teams), plan-aware cost-guard tuned for Claude Max subscribers, taste auto-bootstrap via /deepresearch, full remote-from-phone operation stack.

### Added — multispec engine + parallelism

- `packages/runtime/src/multispec.ts` — flagship pipeline: `/deepresearch` → multispec decomposition → `/specqa` → `/introspect` → parallel `/goal` per DAG leaf → per-sub-spec `/verify` → rollup `/verify`. Default behavior of every umbrella (no `--multi` flag).
- `packages/runtime/src/agent-teams.ts` — Mode B driver wrapping Claude Code Agent Teams (experimental v2.1.32) with shared task list + worktree isolation per teammate. Auto-selected when sub-spec count > 5 OR estimated duration > 30 min OR cross-spec coordination required OR overlapping write sets.
- `packages/runtime/src/orchestrator.ts` refactored — Mode A (SDK subagents in one `query()` session with `agents:` map) is default. New `computeParallelCap()` takes min of hardware cap (3 / 6 / 10) and credit-aware cap (`floor((remaining credit / per-packet) * 0.3)`).

### Added — subscription-first billing

- `packages/runtime/src/billing.ts` — `detectPlan()` reads `CMAX_PLAN` env, falls back to `ANTHROPIC_API_KEY` presence, falls back to probing `claude config get plan`. Default plan: `max5x` when nothing is detected.
- `packages/core/src/cost.ts` — `MONTHLY_CREDIT_USD` per plan (Max20x $200, Max5x $100, Pro $20, api null). `formatCost()` produces dual format ("$X • Y% of $Z monthly credit"). `budgetTag()` thresholds: < 70% ok, 70-90% guard, 90-95% danger, > 95% blocked. Identical for both Max tiers.
- `packages/core/src/router.ts` — plan-aware demotion: at guard / danger / blocked, demote non-essential Opus → Sonnet. `verify` / `spec` / `architect` are in NEVER_DEMOTE and stay Opus regardless. `RouteDecision` gains `demoted` field alongside `escalated`.

### Added — auto-bootstrap taste (no 10-question wizard)

- `packages/runtime/src/taste.ts` — reads repo signals (README + package manifest + framework detection) → `/deepresearch` SOTA for the detected domain at *current time* → Opus synthesizes `taste.md` + `taste.vision` with zero questions. One fallback question only when the repo has no signal.
- `cmax taste init` CLI command.

### Added — new runtime modules

- `packages/runtime/src/deepresearch.ts` — parallel WebSearch + WebFetch with source ledger, `outputFormat: json_schema` for structured ResearchBrief.
- `packages/runtime/src/hive.ts` — N parallel proposers + Opus merger.
- `packages/runtime/src/council.ts` — 3-Opus adversarial debate (proposer / critic / judge).
- `packages/runtime/src/agent-factory.ts` — Hermes-style AgentDefinition registry at `agents/registry.json`.
- `packages/runtime/src/overnight.ts` — long-running mode with file checkpointing + session resumption + budget cap.

### Added — remote operation stack

- `cmax bg setup --projects ...` — creates tmux session 'claudemax' with one window per project.
- `cmax bg status` — live probe of tmux, Tailscale (with hostname), curl, NTFY_TOPIC, claude CLI.
- `cmax bg phone` — phone-side onboarding with QR codes (when `qrencode` available) for ntfy deep link, Tailscale download, Termius (iOS), Termux (Android). Auto-generates `NTFY_TOPIC` and persists to `~/.claudemax-state/config.json`.
- `cmax bg kill` — clean teardown of the tmux session.
- `.claude/hooks/cmax-stop.sh` — ntfy.sh push notification on every claudemax run completion; reads `NTFY_TOPIC` from env or global config; includes project name + file-change count.
- `docs/REMOTE_OPERATION.md` — full evidence-based setup guide (Tailscale + Termius/Termux + tmux + ntfy + voice).
- `setup.sh` (rewritten) — auto-installs tmux + qrencode + Tailscale via apt/brew/dnf/pacman with sudo confirms, builds + symlinks `cmax`, generates `NTFY_TOPIC`, prints phone-side QR codes, runs `cmax doctor` + `cmax bg status`.

### Added — new CLI commands

- `cmax run` — multispec pipeline always on. Flags: `--variant {opussonnet|opusolo}`, `--mode {auto|solo|teams}`, `--no-research`, `--no-verify`.
- `cmax doctor` — billing mode + parallel cap + auth surface introspection.
- `cmax research <topic>` — `/deepresearch` standalone; persists sources to `memory.research_sources`.
- `cmax overnight <spec> --budget-credits N` — long-running mode.
- `cmax config get / set / list / path` — project-level config.
- `cmax taste init` — auto-bootstrap.
- `cmax bg {setup|status|phone|kill}` — remote orchestration.

### Added — 26 skills (audited for overlap)

4 umbrellas: `/cmax`, `/workflow`, `/opussonnet`, `/opusolo`.
5 research: `/deepresearch`, `/audit`, `/investigate`, `/codesearch`, `/introspect`.
2 planning: `/spec`, `/specqa`.
4 execution: `/goal`, `/parallel`, `/hive`, `/council`.
3 verification: `/verify`, `/review`, `/ship`.
3 memory/state: `/memory`, `/align`, `/overnight`.
2 taste: `/taste`, `/deepretaste`.
3 infrastructure: `/agentfactory`, `/route`, `/agentteams`.

### Added — memory schema extensions

`research_sources`, `taste_history`, `sub_specs` tables. `runs` gains `plan` + `mode` columns. New `creditConsumedThisPeriod()` rollup.

### Added — dark-patterns hooks integration

`.claude/settings.json` enables `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true`; `.claude/DARK_PATTERNS_INSTALL.md` documents install of `waitdeadai/llm-dark-patterns` (31 hooks: no-vibes, no-emoji-spam, no-aggregator-hallucination, honest-eta, no-fake-cite, etc.).

### Added — brand assets

`assets/avatar.svg` (512×512 hex agent-mesh), `assets/wordmark.svg` (banner), `assets/icon-mono.svg` (favicon). Electric cyan `#00E5FF` on deep-ink `#0A0E1A`. Non-infringement notes in `assets/README.md`.

### Added — docs

`ARCHITECTURE.md`, `MULTISPEC.md`, `PARALLELISM.md`, `AGENT_TEAMS.md`, `WORKFLOW_VARIANTS.md`, `SKILL_CATALOG.md`, `TASTE_AUTOBOOTSTRAP.md`, `V1_TO_V2_MIGRATION.md`, `REMOTE_OPERATION.md`, updated `MODEL_ROUTING.md` / `GOAL_PIPELINE.md` / `QUICKSTART.md` / `README.md` / `CLAUDE.md`.

### Changed

- Dropped `@anthropic-ai/sdk` dependency entirely. All provider calls route through `@anthropic-ai/claude-agent-sdk` `query()` so they bill against the Agent SDK credit pool (separate from interactive usage since Anthropic's June 15 2026 billing split).
- `goal.ts` / `verify.ts` / `spec-writer.ts` / `orchestrator.ts` all opt into native SDK features: `settingSources: ['user', 'project']`, `skills: 'all'`, `effort: 'max'`, `fallbackModel: 'claude-sonnet-4-6'`, `enableFileCheckpointing`, `agentProgressSummaries`, `forwardSubagentText`, `abortController`, `outputFormat: { type: 'json_schema', schema }`.
- Multispec is the default behavior of every umbrella; the legacy single-spec `cmax spec` + `cmax goal` flow remains for low-level use.

### Removed

- v1's MiniMax integration paths entirely (no `/opusminimax`, `/sonnetminimax`).
- Skills that overlapped or duplicated functionality: `/webresearch` (merged into `/deepresearch`), `/autoplan` (merged into multispec engine), `/qa` (merged into `/verify`), `/tastebootstrap` (replaced by `/taste` auto-bootstrap), `/sonnetonly` / `/hiveworkflow` / `/opusworkflow` (overlap with `/opussonnet`).
- `/digestaste`, `/digestflow` as user-facing skills — they're internal runtime functions used by hooks.

### Tests

72 unit + 67 smoke = 139 local checks passing.

## [0.1.0] — 2026-05-20

Initial scaffold. pnpm monorepo (`packages/core`, `packages/runtime`, `packages/memory`, `packages/cli`) + 7 skills + 4 docs. Router with rule-based escalation/demotion. Spec writer + /goal driver + blind Opus verifier wired to `@anthropic-ai/claude-agent-sdk`. SQLite + FTS5 memory store. CLI binary `cmax`. Released alongside this session — superseded by 0.2.0 the same day.
