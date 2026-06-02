# Changelog

All notable changes to claudemax. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — 2026-06-02 Effectiveness OS (close the proxy↔intent gap: decomposed+adversarial verify, default-FAIL completion gate, PRC, SSC, eval)

Implements the §8 roadmap of `claudemax-OS-efectividad-definitivo.md` — structural defenses against specification-gaming / over-claiming ("says done, breaks in prod"). Effort (`xhigh`) does not close that gap; precise specs + hard-to-game verification + an evidence-gated completion gate do. Full design + as-shipped status in [`docs/EFFECTIVENESS_OS.md`](docs/EFFECTIVENESS_OS.md). 6 tranches, +69 tests (runtime 203→272), full suite green.

- **Verdict artifact (keystone, NEW `packages/runtime/src/verdict-artifact.ts`):** `verify()` now persists `.claudemax/state/verdict-<hash>.json`; `computeGate()` is the single, shared, **default-FAIL** definition of "done" (an omitted condition ⇒ fail; "met" with empty evidence ⇒ fail; verdict defaults to `unverified`). The TS verifier and the bash Stop hook agree on exactly that one function.
- **Decomposed verify (`verify.ts`):** one blind Opus verifier PER completion condition, bounded-parallel, with a hard per-unit wall-clock timeout (a hung condition fails only itself); evidence-required; strict verdict; legacy monolithic pass kept behind `decomposed:false`. Shared `concurrency.ts` (mapWithConcurrency + withTimeout).
- **Adversarial / mutation / isomorphic verify (NEW `mutation-verify.ts`; `--adversarial`):** fabricated-claim mutants the verifier MUST reject + an isomorphic restatement it must stay stable under; a gameable MET condition is downgraded to not-met before the verdict.
- **PRC — production-ready is the default bar (NEW `prc.ts`; `vault/decisions/production-readiness-contract.md`, `invariant:true`):** `multispec decompose` auto-augments every sub-Spec + rollup with PRC conditions (no stubs / error-handling / edge-cases / no-regressions / types-lint / integration), each with a mechanical verifyHint; `--mvp` opts out (MVP is the exception, not the default).
- **Specification Self-Correction (NEW `ssc.ts`; `--ssc`):** harden a spec before execution (tighten gameable verifyHints, add edge/failure coverage) + re-examine a verify that "passed too easily".
- **`cmax eval` (NEW `eval.ts` + command; `--ablations`):** production-hotfix-rate, verifier false-positive rate, and a full/no-verify/no-ssc/no-adversarial ablation matrix; `eval/tasks.example.json` scaffold (private `eval/tasks.json` gitignored).
- **Completion-gate hooks (NEW, wired additively in `settings.json`):** `.claude/hooks/cmax-verdict-gate.sh` (Stop/SubagentStop — `exit 2` ONLY when an active run's verdict is on disk AND failing; fail-open otherwise) + `.claude/hooks/cmax-stub-gate.sh` (PreToolUse — blocks stub/TODO into production source, skips tests/docs). Default-on; escapes `CMAX_VERDICT_GATE_OFF=1` / `CMAX_STUB_GATE_OFF=1`.
- **Frontend + long-run primitives (NEW `frontend.ts`, `reinject.ts`, `synthesis.ts`):** Playwright a11y/screenshot probe builders + a graduable design rubric; anti-prompt-decay spec re-injection + a deterministic poison-pill checkpoint; map-reduce `hierarchicalMerge` for decomposed fan-in.
- **Skills:** `/specqa` + `/verify` document PRC inheritance and the decomposed / default-FAIL / adversarial mechanics.
- **Honest scope (§7):** the adversarial judges + the SSC hardener default to live Opus calls — unit-tested via injected fakes, **not exercised against the live API in this change**; frontend probes need Playwright in the target repo (report `PLAYWRIGHT_MISSING`, never fake); reinject/poison-pill + `hierarchicalMerge` ship as adopt-as-needed helpers. Cites Specification Self-Correction (arXiv:2507.18742) and Graph of Verification (arXiv:2506.12509), both verified live.

### Added — 2026-05-31 searchoclock integration (date-aware failure research → errors_solutions write side)

`searchoclock` (`waitdeadai/searchoclock`, v0.3.0) is the **write side** of the grounding loop: on a Bash failure it injects date-anchored deep-research troubleshooting context, dispatches a clean-context researcher that probes the solution space against live, dated sources, and requires an **independent second model** (Haiku 4.5) to agree from raw evidence before a fix is trusted — then records the validated durable fix into `errors_solutions`, which `grounded-worker` later reads via `mcp__memory__memory_search`. Implements `docs/SEARCHOCLOCK_INTEGRATION_PLAN.md` (reconciled against the `vendor/llm-dark-patterns` sibling convention + the grounding-layer merge; see [`docs/searchoclock.md`](docs/searchoclock.md)).

- **HYBRID consumption (vendor the hook + copy de-namespaced agents/command):** the 38 KB `searchoclock.sh` is **vendored** like `llm-dark-patterns` — gitignored `vendor/searchoclock/`, fetched by `pnpm searchoclock:sync` + `setup.sh`/`install.sh`, wrapped by the new discovery script `.claude/hooks/soc.sh`. The two subagents + the `/searchoclock` command are **copied + de-namespaced** into the repo's committed first-party `.claude/agents/searchoclock-{researcher,validator}.md` + `.claude/commands/searchoclock.md` (sibling to `grounded-worker.md`). Pure vendoring alone would break the upstream `searchoclock:`-namespaced agent dispatch (which resolves only under `/plugin install`); pure marketplace-install would break the repo's offline-first vendor convention. The hybrid keeps both.
- **`.claude/hooks/soc.sh` (NEW, committed):** discovery wrapper analogous to `dp.sh` — locates the vendored `searchoclock.sh` (env override → `CLAUDE_PLUGIN_ROOT/vendor` → walk-up → `~/.claudemax/vendor` → per-project copy), execs it with any positional arg (`preflight`) and stdin intact, fail-open `exit 0` if not found.
- **`scripts/soc-denamespace.mjs` (NEW, committed):** post-fetch reconciliation. Rewrites the **vendored hook** in place to dispatch BARE agent names and refreshes the committed agents + command from upstream, de-namespaced. Deterministic + re-runnable (operates on the freshly-cloned upstream, so the vendored file never drifts). Run by `searchoclock:sync` and both installers.
- **`.claude/settings.json` (ADDITIVE ONLY):** new top-level `PostToolUseFailure(Bash)` (PRIMARY trigger) + a defensive `PostToolUse(Bash)` sibling block + an opt-in `PreToolUse(Bash) preflight` sibling block, all → `bash .claude/hooks/soc.sh`. Four `permissions.allow` additions: `WebFetch(domain:*)` + bare `Agent(searchoclock-researcher)` / `Agent(searchoclock-validator)`. Twelve `env` defaults. Every pre-existing hook/permission/env was preserved verbatim (Stop=26, SubagentStop=10, etc.).
- **Anthropic-only validator (hard rule #1):** `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER=""` (EMPTY), validator `claude-haiku-4-5-20251001`, escalate `claude-sonnet-4-6`. The empty-string default IS the contract; the smoke guard asserts it stays empty. PROACTIVE preflight stays off (`SEARCHOCLOCK_PROACTIVE=0`); severity floor raised to `medium` for a workflow-heavy harness.
- **`package.json`:** new `searchoclock:sync` script (mirrors `dark-patterns:sync` + runs the de-namespace step); `postinstall` extended with a second warn-only hint (kept non-fatal via `|| true`).
- **`setup.sh` / `install.sh`:** tiered vendor clause mirroring the dark-patterns block (non-fatal, runs the de-namespace step). `setup.sh` adds a `--skip-searchoclock` flag.
- **`scripts/smoke.sh`:** new guard block — vendored hook fail-opens (`exit 0`), no residual `searchoclock:` token in the de-namespaced hook, bare agent names in settings perms, `CROSS_PROVIDER` empty, `soc.sh` executable, committed agents/command present, `settings.json` valid JSON with all pre-existing hooks intact.
- **`.gitignore`:** `.searchoclock/` (the hook's `last-error.md` + `state.json` state dir) added; `vendor/` already ignored.
- **Docs:** new `docs/searchoclock.md`; `docs/grounding-layer.md` gains the write-side synergy line; `CLAUDE.md` repo shape + new working rule #13; `README.md` hooks line.
- **NOT a new skill.** `/searchoclock` is a *command* (`.claude/commands/`), not a catalog skill — it does not count against the lean skill catalog and needs no SKILL_CATALOG overlap audit (working rule #2). Noted so a future `/harness-audit` doesn't flag it.

### Added — 2026-05-31 Grounding layer (durable, dated, enforced source of truth for fresh subagents)

A fresh subagent does not inherit the lead's conversation history — so anything it must treat as true now lives in a durable, addressable, dated, enforced artifact, with an identical read path for Mode A (SDK subagents) and Mode B (Agent Teams). Implements `docs/GROUNDING_LAYER_PLAN.md` (reconciled against the existing `packages/memory` store; see [`docs/grounding-layer.md`](docs/grounding-layer.md)).

- **`packages/memory` (schema, additive):** the existing `decisions` table gained grounding columns (`slug`, `status`, `scope`, `invariant`, `ttl_days`, `source_path`, `tags`) via the idempotent `migrate()` ALTER pattern — **never a second `decisions` table**. New `project_facts` table in `SCHEMA_SQL`. Staleness reuses the existing `last_verified_at` + `verified_count` mechanism (no parallel `verified_on` column); `ttl_days` is an optional per-row window override. New read methods (`getDecisionBySlug`, `getFact` with most-specific-glob-wins, `staleTruth`, `searchGrounding` over the shared `mem_fts`) + write helpers (`proposeDecision`, `proposeFact`).
- **`packages/memory-mcp` (NEW):** read-only stdio MCP wrapping the store's read methods over a `{ readonly: true }` handle. Four tools — `memory_search`, `memory_get_decision`, `memory_get_fact`, `memory_stale` — surfaced as `mcp__memory__*`. No `dump_all` by design (retrieval-on-demand, never context flooding).
- **`packages/grounding` (NEW):** `cmax ground migrate | compile | export`. `compile` promotes `blessed: true` vault notes → `accepted` memory rows, then compiles `invariant=1` rows into the `GROUNDING:BEGIN … END` managed block of the matching `CLAUDE.md`. `export` writes proposed rows lacking vault provenance into `vault/_inbox/` for human review. All idempotent.
- **`cmax memory propose-decision` / `propose-fact`:** thin wrappers over the store append path, landing `status='proposed'`. Agents propose; humans bless in the vault; compile promotes. Agents never self-bless.
- **`.claude/hooks/freshness-gate.sh` (NEW):** first-party hook referenced **directly** in `settings.json` (SessionStart + SubagentStop), not via `dp.sh`. Fail-open (exit 0, single line of JSON), injects `hookSpecificOutput.additionalContext` when an invariant is past its verify-by window or the CLAUDE.md block is stale vs memory. Never blocks.
- **`.claude/agents/grounded-worker.md` (NEW)** + **`GROUNDED_WORKER_CONTRACT`** (`packages/runtime/src/prompts.ts`): the worker grounding contract, prepended to every sub-Spec leaf spawn. Mode A query() calls (`orchestrator.ts`, `goal.ts`) also register the memory MCP inline via `memoryMcpServerConfig()` (`sdk-options.ts`) + add `mcp__memory__*` to `allowedTools`; Mode B teammates (`agent-teams.ts`) inherit the server from the committed `.mcp.json`.
- **`.mcp.json` (NEW, committed):** registers the first-party `memory` server (project scope) for Claude Code / Mode B; the SDK inherits it via `settingSources: ["user","project"]`. The one bundled-MCP exception to "claudemax does not bundle MCP servers" — documented in `docs/MCP_SERVERS.md`.
- **`vault/` (NEW, committed markdown):** Obsidian vault scaffold (`decisions/`, `facts/`, `_inbox/`, `_moc/`) seeded with claudemax invariants (anthropic-only, Opus-for-verify/spec/architect, multispec-default, subscription-first auth, two parallelism modes).
- **Docs:** new `docs/grounding-layer.md`; `docs/MCP_SERVERS.md` notes the bundled `memory` server; `CLAUDE.md` repository shape + a working rule for the propose→bless→compile invariant.

### Removed — 2026-05-28 Trim vestigial alias skills (de-collide with the native Workflow tool)

Claude Code shipped a native **Workflow tool** ("dynamic workflows" — opt-in deterministic multi-subagent orchestration, public research preview 2026-05-28, CLI v2.1.154+, triggered by the word "workflow"). Our `/workflow` umbrella *skill* — a self-described "ALIAS for /cmax, kept only for v1 muscle memory" — collided with it head-on. Deepresearch + an empirical probe (a Workflow-tool subagent's `rm -rf` was blocked by our `no-vibes` PreToolUse hook, exit 2) confirmed the **hook-event** steering layer carries into native workflows, while the cmax CLI/skill pipeline does not auto-engage in a raw workflow — so the right move is to lean the catalog, not duplicate native capability.

- **Removed skills:** `skills/workflow/`, `skills/opussonnet/` (both ALIAS-for-/cmax; `/workflow` also collided with the native tool) and the deprecated `skills/dispatch/` stub (use `/parallel` or the CLI `cmax dispatch`). Catalog: 34 → **31 skill directories, all active** (no aliases, no deprecated stubs).
- **Kept (unchanged):** the `opussonnet`/`opusolo` model-routing **variants** — they live in the CLI (`cmax run --variant {opussonnet|opusolo}`) and in `packages/core/src/models.ts` (`execModelForVariant`), not as skills. `variant-routing.test.ts` still guards them. The `cmax dispatch` CLI subcommand is also kept.
- **Updated:** `packages/cli/src/commands/init.ts` (advertised slash list), `scripts/smoke.sh` (now asserts `init` *omits* the removed aliases — regression guard), `README.md`, `skills/README.md`, `docs/SKILL_CATALOG.md`, `docs/WORKFLOW_VARIANTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`.

### Fixed — 2026-05-28 `cmax goal --max-turns` is now a hard, pool-safe bound

- **`packages/runtime/src/goal.ts`**: `runGoal` enforced the turn cap only through the SDK's `maxTurns` option, which does **not** bound a goal loop that fans out via the Agent tool — a run launched with `--max-turns 150` was observed reaching **235+ turns** (unbounded autonomous pool burn on a live build). The loop now aborts **deterministically** at our own layer: its own `AbortController` is triggered + the stream `break`s the moment the turn counter hits `maxTurns`. Adds a `queryFn` injection point and `packages/runtime/tests/goal-maxturns.test.ts` (caps exactly at 5; does not prematurely cap a short run that finishes first). 273 tests green.

### Fixed — 2026-05-28 Haiku verify-doubleCheck → WARN-only recall tier (v5-cascade-aligned)

- **`packages/runtime/src/verify.ts` `applyDoubleCheck`**: the Haiku double-check no longer **overrides** the Opus verdict to `"unverified"` on disagreement. That was a weak-judge-overrides-strong anti-pattern — the exact inversion the llm-dark-patterns **v5 cascade study** argues against (its WARN-tier never escalates to BLOCK; the deterministic/strong floor owns the verdict). Now the Haiku tier is **WARN-only**: a cross-model disagreement appends a non-authoritative `⚠ haiku-recall-check` note to `report.notes` and **the Opus verdict stands** (reinforces house rule #4 — verify authority is Opus). The Haiku prompt is reframed as a false-pass / over-optimism (sycophancy) recall check rather than a verdict re-vote. Strictly additive: worst case is a noisy warning, never a wrongly-overridden verdict.
- `packages/runtime/tests/verify-doublecheck.test.ts` updated: disagreement now asserts verdict-preserved + warning-in-notes (was: verdict→unverified).
- `docs/HAIKU_JUDGE.md` updated to the WARN-only shape. Diagnosis confirmed: claudemax's tier judges the internal `VerificationReport` (disjoint from llm-dark-patterns' closeout-TEXT hooks); the dark-patterns **v5 Haiku WARN cascade is merged to llm-dark-patterns `main`** — this install's vendored copy was re-synced to it.

### Changed — 2026-05-28 Opus 4.8 retarget (primary model + xhigh/ultracode tailoring)

Opus 4.8 shipped 2026-05-28. Verified live against [Anthropic's announcement](https://www.anthropic.com/news/claude-opus-4-8), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview), and the [Effort guide](https://platform.claude.com/docs/en/build-with-claude/effort) (all accessed 2026-05-28). Pricing, context (1M), max output (128k), and cache structure are **unchanged** from 4.7 — only the model id and behavior tuning move.

- **Primary model `claude-opus-4-7` → `claude-opus-4-8`.** Single load-bearing pin in `packages/core/src/models.ts` (the `opus` tier id) + the `ModelId` union in `types.ts`; every runtime/CLI/skill site resolves Opus via `MODELS.opus.id`, so the whole pipeline retargets from these two literals. `.claude/settings.json` REPL pin bumped in lockstep. Opus strengths gain "honest self-review (4× fewer unflagged code flaws than 4.7)".
- **Era-aware default executor.** `execModelForVariant(variant, era)` now takes a billing era. In the **pre-split era** (until 2026-06-15) Opus and Sonnet share one 5h subscription pool, so the cost rationale for Sonnet execution evaporates — `opussonnet` (the `/cmax`/`/ask` default) executes sub-Specs on **Opus 4.8** for maximum effectiveness (4× fewer unflagged flaws, agentic coding 64.3→69.2). **Post-split** it auto-reverts to Sonnet. `run.ts` supplies the live era via `resolveBillingEra()`. `--variant opusolo` forces Opus every era; `--cheap`/explicit Sonnet remains the cost-conscious escape hatch. plan/decompose + verify stay Opus regardless (house rule #4, untouched).
- **`--effort {high|xhigh|max}` flag** on `cmax run`, threaded to the `runGoal` / `runTddCycle` execution lanes. Default stays **`xhigh`** — Anthropic's recommended tier for agentic/coding + long-running work, now vindicated for 4.8. **`max` is opt-in only**: measured ~3% gain over xhigh for ~2× tokens/pool burn, and it can *overthink* structured-output lanes (spec/verify), so it is never the standing default. `thinking` stays `adaptive` (4.8 rejects manual extended thinking with a 400).
- **`spec-writer.ts` effort pinned to `xhigh`** + `thinking: adaptive`. Previously set no effort, so under 4.8 it would silently fall to the SDK `high` default on a never-demote judgment lane.

### Fixed — 2026-05-28 (pre-existing pricing bugs surfaced by the 4.8 audit)

- **`packages/runtime/src/overnight.ts` `estimateUsd`** hardcoded legacy `$15/$75` Opus pricing — a 3× overcount that tripped the overnight budget loop early (harmless pre-split, wrong post-split). Now reads `MODELS.opus.{inputPer1MUsd,outputPer1MUsd}` ($5/$25) from the registry so it auto-tracks the catalog.
- **`docs/MODEL_ROUTING.md` tier-pricing table** had the same legacy `$15/$1.50/$75` Opus row — corrected to `$5/$0.50/$25`.

### Changed — 2026-05-28 docs/test sweep for 4.8

- Model-version prose refreshed to Opus 4.8 across `sdk-options.ts`, `orchestrator.ts`, `goal.ts`, `prompts.ts` (live worker system prompt), `plugin.json`, `README.md`, `skills/opusolo/SKILL.md`, and `docs/SOTA_2026.md` (largest cluster — re-pinned capability bullets, added an Opus-4.8 subsection covering Dynamic Workflows / fast mode / mid-task system messages / honesty gain, and resolved the stale "defaults to max" vs `xhigh` contradiction). `CLAUDE.md` billing-era date 2026-05-22 → 2026-05-28.
- Test prose + the coupled literal in `variant-routing.test.ts` (`opusolo` → `claude-opus-4-8`) bumped; added era-aware guards (opussonnet → Opus pre-split / Sonnet post-split). `cache.test.ts` + `store-sota.test.ts` prose → 4.8 (all numeric pricing/context assertions unchanged and still green). `pnpm build && typecheck && test` green.

### Deferred (flagged by the audit; need a dedicated pass, NOT auto-applied)

- **Dynamic Workflows as a `Mode C`** — routed through `/cc-audit` + `/harness-audit` instead of guessing an env flag (it auto-activates with 4.8; adding a third auto-selected parallelism arm changes house rule #7's two-mode contract).
- **Haiku verifier double-check** — kept opt-in/off-by-default; the 4.8 honesty gain weakens its original rationale, but replacing it with a second Opus pass reverses commit `5efecd4` and needs `/council` + ~30-run validation.
- **Version bump** (0.2.2 → 0.3.0) for this retarget — pending; touches root + plugin.json + 4 workspace packages + the OTEL/doctor version-assertion tests in lockstep.

### Added — 2026-05-22 daily-effectiveness improvement run (cmax orchestrate 5-lane)

- **`packages/runtime/src/agent-teams.ts` true parallel dispatch.** Mode B (Claude Code Agent Teams) sub-Specs now run in a DAG-aware bounded-parallel dispatcher instead of the sequential `for...await` loop. Independent leaves dispatch concurrently via `Promise.race(active)` over an active-set capped by `MAX_PARALLEL_AGENTS` (env) or `os.cpus().length`. Dependency chains from `multispec.dependencies` are honoured; cycle-stuck sub-Specs fail fast rather than deadlock. Closes the gap between CLAUDE.md rule #7's stated "max parallel by default" and Mode B's prior actual behaviour. `packages/runtime/tests/agent-teams.test.ts` adds N=4 parallelism smoke + DAG enforcement + maxParallel=2 cap + cycle handling, all using a `_spawnTeammate` injection to avoid spawning real `claude -p` subprocesses in CI.
- **`skills/specqa/SKILL.md`** ported from minmaxing v1 — spec quality gate; blocks `/goal` handoff when a completion condition lacks a mechanically-checkable verifyHint. Pairs with the multispec engine's auto-generated sub-Specs to catch weak hints before they waste a `/goal` run.
- **`skills/cc-audit/SKILL.md`** — SOTA-2026 deepresearch-backed audit of new Claude Code CLI releases. Pulls primary sources (canonical CHANGELOG.md, Anthropic docs, GH release notes), corroborates third-party signals (tweets, blogs, changelog mirrors), and emits per-change verdict (IGNORE / WRAP / INTEGRATE / DEFER). Caught this session: @ClaudeCodeLog tweet bot claimed 2.1.147 added a "Workflow tool (CLAUDE_CODE_WORKFLOWS=1)" — primary sources had no such entry; verdict was `unverified` and the harness skipped a fictitious integration.
- **`packages/cli/src/commands/doctor.ts` --hooks flag** — lists every wired Stop/Pre/Post hook from `~/.claude/settings.json` + `.claude/settings.json` with source path, plus the resolved `agentcloseout-physics` binary version. Default `cmax doctor` now also asserts `package.json` and `plugin.json` version consistency.
- **`scripts/bump-version.sh`** atomic helper for keeping `package.json` and `plugin.json` in lockstep on SemVer bumps.
- **`install.sh` + `install.ps1` shell-alias guidance** at end of install — surfaces the `alias claude='claude --dangerously-skip-permissions'` recommendation per shell (`~/.bashrc`/`~/.zshrc`/`~/.config/fish/config.fish`/`$PROFILE`) with copy-paste-ready commands. Does NOT auto-modify rc files. Eliminates the v0.2.x first-day friction documented in `plugin.json._schemaNote`.
- **`LICENSE` upgraded to canonical Apache-2.0 full text (202 lines).** GitHub's SPDX auto-detector now recognises the repo as `Apache-2.0` instead of `NOASSERTION` (verification post-push).

### Changed

- **`package.json` 0.2.0 → 0.2.2** and **`plugin.json` 0.2.1 → 0.2.2.** README and skill catalog already referenced v0.2.2 features (`/orchestrate`); the manifests now match. Future drift is gated by the new `cmax doctor` version-consistency check.

### Fixed

- **`packages/core/src/models.ts` pricing correction.** Opus 4.7 is **$5 input / $25 output per MTok** (verified 2026-05-20 against [Anthropic's models overview](https://platform.claude.com/docs/en/about-claude/models/overview)). v0.2.0 had the legacy Opus 4.5 prices baked in ($15/$75) — a 3× overestimate of Opus cost. Sonnet 4.6 ($3/$15) and Haiku 4.5 ($1/$5) were already correct. Per-packet cost estimates and plan-aware demote thresholds are now accurate.
- Context windows updated: Opus 4.7 = 1M, Sonnet 4.6 = 1M, Haiku 4.5 = 200k.
- Max output updated: Opus 4.7 = 128k, Sonnet 4.6 = 64k, Haiku 4.5 = 64k.

### Added

- Prompt-caching pricing constants per tier: `cacheWrite5mPer1MUsd` (1.25× base input), `cacheWrite1hPer1MUsd` (2× base input), `cachedInputPer1MUsd` (0.1× base input) per [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
- `cacheStatsFromUsage(tier, usage)` helper in `packages/core/src/cost.ts` — surfaces hit rate, billed input, and $ saved vs counterfactual no-cache cost. Foundation for `cmax memory credit` cache-aware reporting.
- `AgentResult` gains `cacheReadTokens` and `cacheWriteTokens` optional fields.
- `estimatePacketCost` now assumes 50% of static input is cached on subsequent turns (per Anthropic's caching docs hit-rate guidance), giving more realistic estimates for multi-turn workflows.
- `docs/SOTA_2026.md` — live-research synthesis comparing claudemax to Anthropic Agent Teams, Ruflo (formerly claude-flow, 31k stars), wshobson/agents, Forge, Composio AO, and the broader 2026 multi-agent ecosystem. Includes adopted-vs-not SDK option matrix and open research questions.
- `SECURITY.md` subscription-compliance section — explicit note that claudemax routes through the Agent SDK credit pool, unaffected by the [April 4 2026 OpenClaw block](https://thenextweb.com/news/anthropic-openclaw-claude-subscription-ban-cost) which Anthropic [reversed](https://www.datagrom.com/ai-news/anthropic-reverses-ban-on-third-party-ai-agent-use-8ec3aaa6).
- `packages/core/tests/cache.test.ts` — 11 new tests covering verified pricing constants, cache-stats math, and cost-with-cache-writes arithmetic.

### Added — SOTA SDK alignment (all 7 follow-ups landed)

- `packages/runtime/src/sdk-options.ts` — centralized `baseSdkOptions()` builder + `EffortLevel` type + `estimateTaskBudgetTokens()` + `parseUsageWithCache()`. All `query()` call sites now spread the baseline through one helper so the SDK option set stays consistent.
- **`effort: 'xhigh'` is the new default** (Anthropic's recommended setting for Opus 4.7 coding per [release notes](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)). Users can still override to `'max'` via the runtime `effort` option or `--effort max` CLI flag.
- **`thinking: { type: 'adaptive' }` opt-in for reasoning roles.** Opus 4.7 ships adaptive thinking OFF by default. claudemax now explicitly enables it for `goal`, `verify`, and any opus-tier packet in the orchestrator.
- **`task_budget` beta wired.** When `maxBudgetUsd` is set, the runtime auto-computes a corresponding `task_budget.total` (per-tier token estimate) and sends it alongside the `task-budgets-2026-03-13` beta header. The model is AWARE of the budget countdown and self-paces — distinct from `maxBudgetUsd` which is a hard cap.
- **Opt-in SDK options exposed via `baseSdkOptions()`**: `includeHookEvents`, `strictMcpConfig`, `sessionStoreFlush: 'eager'` (the last enables near-real-time transcript mirror for live-tailing Mode B agent-teams).
- **Cache token tracking end-to-end.** `parseUsageWithCache()` extracts `cache_read_input_tokens` and `cache_creation.ephemeral_5m/1h_input_tokens` from result messages. `AgentResult` and `GoalRunResult` propagate `cacheReadTokens` / `cacheWriteTokens`. `RunRecord` persists them. `memory.runs` schema gains `cache_read_tokens` and `cache_write_tokens` columns (with idempotent forward migration for existing DBs).
- **`cmax memory credit` subcommand.** Shows current-period Agent SDK credit consumption (`formatPlanBudgetState`) AND prompt cache hit rate (`cacheStatsThisPeriod`). Warns if hit rate < 30% on > 100k input tokens (likely [SDK caching bug #188](https://github.com/anthropics/claude-agent-sdk-typescript/issues/188)).
- **PACKET_AGENT_SYSTEM prompt updated** with explicit fan-out instruction. Opus 4.7's "fewer subagents spawned by default" behavior would otherwise serialize work; workers are now told to invoke the Agent tool multiple times in one assistant turn for parallel execution.
- **`docs/MCP_SERVERS.md`** — recommended MCP server configs for software-engineering power users: Playwright, Vercel, Supabase, GitHub, Figma, Slack, Postgres. Includes anti-recommendations and notes on `strictMcpConfig`.

### Tests

- `pnpm test` → 83 unit tests (44 core + 6 memory + 33 runtime).
- `bash scripts/smoke.sh` → 90 smoke checks (added 3 for `memory credit` subcommand).
- All green locally; CI green on push.

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

### Added — 29 active skills (audited for overlap)

5 umbrellas: `/ask`, `/cmax`, `/workflow` (alias), `/opussonnet` (alias), `/opusolo`.
5 research: `/deepresearch`, `/audit`, `/investigate`, `/codesearch`, `/introspect`.
2 planning: `/spec`, `/specqa`.
5 execution: `/goal`, `/tdd`, `/parallel`, `/hive`, `/council`.
3 verification: `/verify`, `/review`, `/ship`.
3 memory/state: `/memory`, `/align`, `/overnight`.
2 taste: `/taste`, `/deepretaste`.
4 infrastructure: `/agentfactory`, `/route`, `/agentteams`, `/harness-audit`.
Plus 1 deprecated stub: `/dispatch` (use `/parallel` or `cmax dispatch` instead).

### Added — memory schema extensions

`research_sources`, `taste_history`, `sub_specs` tables. `runs` gains `plan` + `mode` columns. New `creditConsumedThisPeriod()` rollup.

### Added — dark-patterns hooks integration

`.claude/settings.json` enables `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true`; `.claude/DARK_PATTERNS_INSTALL.md` documents install of `waitdeadai/llm-dark-patterns` (35 hooks: no-vibes, no-emoji-spam, no-aggregator-hallucination, honest-eta, no-fake-cite, etc.).

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
