# Dark-patterns hooks — bundled by default

claudemax ships [waitdeadai/llm-dark-patterns](https://github.com/waitdeadai/llm-dark-patterns) **as a vendored sibling repo**, not as a separate plugin install. The hooks are wired into Claude Code's hook events automatically through `cmax init` and through this repo's own `.claude/settings.json`.

## How it's wired

- `vendor/llm-dark-patterns/` — git clone of the hooks repo. Created by `setup.sh` on first install; updated via `pnpm dark-patterns:sync`.
- `.claude/hooks/dp.sh` — wrapper that auto-discovers `vendor/llm-dark-patterns/hooks/` (walks up from `$PWD`, checks `$CLAUDE_PLUGIN_ROOT`, `$HOME/.claudemax`, env override `CLAUDEMAX_DP_HOOKS_DIR`, finally falls back to `.claude/hooks/dark-patterns/hooks/`).
- `.claude/settings.json` — hook entries reference `bash .claude/hooks/dp.sh <hook-name>.sh` so the same settings work regardless of absolute install path.
- `cmax init` — copies the entire `vendor/llm-dark-patterns/` tree to `<target>/.claude/hooks/dark-patterns/` AND merges the hook entries from `hooks/hooks.json` (rewritten to use `dp.sh`) into `<target>/.claude/settings.json`.

Result: a fresh install of claudemax via `setup.sh` already has the dark-patterns hooks live. Running `cmax init` in any project propagates them to that project's `.claude/`.

## Verified shape

On a fresh init, `.claude/settings.json` ends up with hooks across these events:
`SessionStart, UserPromptSubmit, Stop, SubagentStop, PreToolUse, PostToolUse, TaskCreated, TaskCompleted, PreCompact, PostCompact`. Total entries: ~66 (3 claudemax-native + ~63 dark-patterns). All paths resolve through `dp.sh` so they are self-locating.

## Hook categories (high-level)

**Interaction-style** (Stop / SubagentStop):
- `no-vibes` — blocks positive-closeout vocabulary without evidence markers
- `no-curfew` — blocks unsolicited wellness paternalism
- `no-sycophancy` — blocks praise-spam at message open
- `no-cliffhanger` — blocks "want me to continue?" permission-loop endings
- `no-wrap-up` — blocks "anything else?" engagement-fishing
- `no-tldr-bait` — blocks "TL;DR:" / "In summary:" on long messages
- `no-emoji-spam` — blocks > N emoji codepoints (default 3, configurable)
- `no-meta-commentary` — blocks "Let me think about this" chain-of-thought narration
- `no-prompt-restate` — blocks "You asked me to X" preamble waste
- `no-disclaimer-spam` — blocks "Please note that..." defensive padding
- `no-ai-tells` — blocks canonical LLM phrases ("delve into", "tapestry", "leverage cutting-edge")
- `no-roleplay-drift` — blocks "As an AI assistant..." persona breaks
- `honest-eta` — blocks vibe time estimates (requires Agent-Native Estimate shape or hedge range)

**Fact fabrication** (Stop):
- `no-fake-recall` — blocks "as we discussed earlier" without quote
- `no-fake-stats` — blocks fabricated percentages without citation
- `no-fake-cite` — blocks phantom citations without verifiable URL
- `no-phantom-tool-call` — blocks "I ran X and got Y" without tool-result evidence
- `no-rollback-claim-without-evidence` — blocks "I rolled back" without command evidence

**Continuity** (PreCompact / PostCompact / SessionStart / Stop):
- `state.sh` + 4 lifecycle siblings — snapshots + rehydrates context across auto-compaction
- `time-anchor.sh` — injects current system clock at SessionStart + UserPromptSubmit

**Multi-agent honesty** (SubagentStop / TaskCreated / TaskCompleted):
- `no-aggregator-hallucination` — blocks supervisor synthesis without per-worker enumeration
- `no-silent-worker-success` — blocks "all N workers completed" without exit codes
- `no-cherry-pick-rollup` — blocks "4 of 5 succeeded" + positive closeout without explicit failed-worker handling
- `no-ownership-violation` — blocks out-of-scope file edits by subagents
- `no-handoff-loop` — detects same agent_id 3+ times in delegation history

**Safety** (PreToolUse / TaskCreated):
- `no-credential-leak-in-handoff` — blocks plaintext `sk-*` / `ghp_*` / AWS keys in task payloads
- `no-sandbagging-disguise` — blocks "tried but couldn't" without specific blocker
- `no-approval-sneak` — blocks edits to `.env*` / `secrets/` / `.kube/` / `terraform/state/` / `.ssh/` / `.gnupg/` / `prod/` without approval

**Hallucination detection** (Stop):
- `no-unreachable-symbol` — flags references to functions/files that don't exist in the repo

## Configuration

```bash
export LLM_DARK_PATTERNS_EMOJI_THRESHOLD=3      # default; 0 = zero tolerance
export LLM_DARK_PATTERNS_LOCALE=en              # locale pack (en, es, pl)
export LLM_DARK_PATTERNS_DESTRUCTIVE_PACKS=filesystem,container,git-protected
export LLM_DARK_PATTERNS_EVIDENCE_CATEGORIES=app-dev,devops,k8s
export CLAUDEMAX_DP_HOOKS_DIR=/custom/path/to/llm-dark-patterns/hooks   # pin discovery
```

## Updating

```bash
cd ~/.claudemax       # or your install dir
pnpm dark-patterns:sync     # git pulls vendor/llm-dark-patterns to latest
```

For projects already initialised via `cmax init`, re-run `cmax init --force` to refresh their copy.

## Opting out

`cmax init --no-dark-patterns` skips the bundle for that project. The claudemax-native hooks (`cmax-session-start.sh`, `cmax-stop.sh`, `cmax-post-tool-use.sh`) remain.

## Alternative — Claude Code plugin marketplace path

If you'd rather not vendor a copy per machine, you can install via Claude Code's plugin marketplace:

```bash
claude plugin marketplace add waitdeadai/claude-plugins
claude plugin install llm-dark-patterns@waitdeadai-plugins
```

This is supported alongside the bundled path. The bundled-by-default path is the claudemax recommendation because it makes the install self-contained, survives offline / disconnected environments, and avoids requiring users to discover the marketplace.

## Reference

- Repo: https://github.com/waitdeadai/llm-dark-patterns (Apache-2.0)
- Hooks catalog: `vendor/llm-dark-patterns/hooks/`
- Canonical hook event mapping: `vendor/llm-dark-patterns/hooks/hooks.json`
- Implementation language: Bash + Python (Python for `time-anchor`, `state.sh`, `no-emoji-spam`)
- Test suite: `vendor/llm-dark-patterns/tests/`
