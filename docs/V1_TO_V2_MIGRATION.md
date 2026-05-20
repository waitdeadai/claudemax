# minmaxing v1 → claudemax v2 migration

For users of [waitdeadai/minmaxing](https://github.com/waitdeadai/minmaxing) coming to claudemax. Big-picture: v2 is **Anthropic-only**, **lean (29 active skills vs v1's 43)**, and built around the Claude Code 2.1.139 `/goal` validator-loop + multispec decomposition.

## What changed at the top

| Concern | v1 | v2 |
|---|---|---|
| Provider | Anthropic + MiniMax | **Anthropic-only** |
| Daily-driver | `/opusworkflow` (Opus plan + MiniMax exec) | `/cmax` (Opus plan + Sonnet exec) — semantically same as v1 `/opussonnet` |
| Spec | Single SPEC.md | **MultiSpec** (DAG of sub-Specs + rollup conditions) — default behavior |
| Autonomy | Custom workflow loop | Wraps Claude Code's native `/goal` (validator-loop) |
| Parallelism | Hardware-aware packets | **Two modes auto-selected**: SDK subagents (Mode A) or Claude Code Agent Teams (Mode B) |
| Verification | `/verify` skill + agentcloseout-physics | `/verify` (blind Opus) + dark-patterns evidence hooks |
| Taste | `/tastebootstrap` 10-Q wizard | `/taste` auto-bootstrap via `/deepresearch` (NO questions) |
| Skills | 43 skills | **29 active skills + 1 deprecated stub** (overlap-audited; v0.2.1 added `/tdd` + `/harness-audit`) |
| Memory | SQLite + FTS5 (5 tiers) | SQLite + FTS5 (same + `research_sources`, `taste_history`, `sub_specs`) |
| Billing model | Per-token USD estimates | **Plan-aware**: detect Max5x/Max20x; show "$X • Y% of monthly credit" |
| Auth | API key | **Subscription Agent SDK credit** by default (Max 5x/20x); API key opt-out |

## Skill mapping (v1 → v2)

| v1 skill | v2 status | Notes |
|---|---|---|
| `/opusworkflow` | **Renamed/folded** | Same behavior as v1 `/opussonnet` once MiniMax → Sonnet. v2 uses `/cmax` / `/workflow` / `/opussonnet` (aliases) |
| `/opussonnet` | KEPT | v1 muscle memory; routes Opus plan + Sonnet exec |
| `/opusolo` | KEPT | v1 muscle memory; all-Opus mode |
| `/opusminimax`, `/sonnetminimax` | **DROPPED** | MiniMax-specific |
| `/workflow` | KEPT (alias for /cmax) | v1 muscle memory |
| `/sonnetonly`, `/hiveworkflow` | **CUT** | Overlap with /opussonnet + /hive |
| `/deepresearch` | KEPT + enhanced | Source ledger persisted to `memory.research_sources` |
| `/webresearch` | **MERGED into /deepresearch** | /deepresearch uses WebSearch/WebFetch by default |
| `/audit` | KEPT | Adversarial code-quality scan |
| `/introspect` | KEPT | Confidence/assumption hard-gate before /goal handoff |
| `/codesearch` | KEPT | Multi-pattern search with ranking |
| `/investigate` | KEPT | Multi-source bug root-cause |
| `/autoplan` | **MERGED into multispec engine** | Engine auto-decomposes |
| `/specqa` | KEPT | Spec quality gate |
| `/qa` | **MERGED into /verify** | verifyHints can name test commands |
| `/review` | KEPT | Diff review |
| `/ship` | KEPT | Final go/no-go combining /verify + /review |
| `/parallel` | KEPT | User-facing skill for distinct-packet fan-out |
| `/hive` | KEPT | Same problem N times → merge |
| `/council` | KEPT | 3-Opus adversarial debate |
| `/agentfactory` | KEPT | AgentDefinition registry |
| `/tastebootstrap` | **REPLACED by /taste auto-bootstrap** | NO 10 questions; uses /deepresearch |
| `/deepretaste` | KEPT | Drift detection |
| `/digestaste`, `/digestflow` | **CUT (internal functions)** | Used by SessionStart/Stop hooks; not user-facing |
| `/align` | KEPT | Semantic decision recorder |
| `/memory` | KEPT | Persistent store |
| `/overnight` | KEPT | Long-running mode w/ checkpoint resume |
| `/agent-view`, `/remote-control`, `/goal-mode` | **DOCUMENT as native CC** | Built into Claude Code; just document |
| `/agentteams` | **NEW** | Manual invocation of Claude Code Agent Teams (Mode B) |
| `/sprint`, `/defineicp`, `/icpweek`, `/claudeproduct`, `/metacognition`, `/leveragepath`, `/browse`, `/demo`, `/visualize`, `/visualizeworkflow` | **DEFERRED** | Not core to daily SW work in v2 |

## Behavioral differences

### `/cmax` / `/opussonnet` is now FAT

In v1, `/opussonnet` was a thin model-routing variant of `/workflow`. In v2, every umbrella **auto-runs the full pipeline**: deepresearch + multispec decompose + specqa + introspect + parallel /goal per leaf + per-sub-spec verify + rollup verify. They differ only in sub-Spec exec tier.

### Multispec is the default, no flag

v1 had `/sprint` and various decomposers. v2 makes multispec decomposition the **default behavior** of every umbrella — no `--multi` flag. The engine picks single-spec mode internally only if the goal fits in one Spec.

### Two parallelism modes auto-selected

v1 had hardware-aware packets. v2 adds **Mode B (Claude Code Agent Teams)** for big swarm work with shared task list + worktree isolation. The multispec engine auto-selects based on sub-Spec count / est. duration / cross-spec coordination / write-set overlap.

### Verifier never demotes

v1 sometimes demoted /verify under cost pressure. v2 hard rule: **/verify, /spec, /architect always run on Opus**, regardless of `--cheap` or monthly credit %.

### `/taste` is auto-bootstrap, NOT 10 questions

v1's `/tastebootstrap` asked 10 kernel questions. v2's `/taste`: reads repo + /deepresearch SOTA at *current time* → writes taste.md + taste.vision with zero questions. One fallback question only if the repo has no signal.

## Migration steps

1. **Install v2**: `git clone … && pnpm install && pnpm build && ln -s … cmax`
2. **Per-project init**: `cmax init` in your project root. Writes `.claude/skills/* + .claude/hooks/*`.
3. **Plan auto-detection**: `cmax doctor` confirms Max5x/Max20x detection. Override with `CMAX_PLAN=max20x` if auto-detect fails.
4. **Dark-patterns plugin**: `claude plugin marketplace add waitdeadai/claude-plugins && claude plugin install llm-dark-patterns@waitdeadai-plugins`.
5. **First run**: `cmax run "<small goal>"` to confirm the multispec pipeline works end-to-end.
6. **Re-derive taste**: `cmax taste init` to replace any v1 `taste.md` with the auto-bootstrap version.

## What's NOT migrated

- v1's MiniMax-specific configs and scripts (drop entirely).
- v1's `setup.sh` flow (v2 has its own).
- v1's `agentcloseout-physics` engine (replaced by `/verify` + dark-patterns evidence hooks).
- v1's custom hooks (replaced by `cmax-session-start.sh / cmax-stop.sh / cmax-post-tool-use.sh` + dark-patterns plugin).
