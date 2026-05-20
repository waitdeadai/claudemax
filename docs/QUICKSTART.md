# Quickstart

## Install

### Mac / Linux / WSL — one line

```bash
curl -fsSL https://raw.githubusercontent.com/waitdeadai/claudemax/main/install.sh | bash
```

### Windows — PowerShell 5.1+ or 7+

```powershell
irm https://raw.githubusercontent.com/waitdeadai/claudemax/main/install.ps1 | iex
```

### Manual (advanced)

```bash
git clone https://github.com/waitdeadai/claudemax ~/.claudemax
cd ~/.claudemax
pnpm install
pnpm build
sudo ln -sf $PWD/packages/cli/dist/index.js /usr/local/bin/cmax
```

### Remote-from-phone flow (Tailscale + tmux + ntfy + QR onboarding)

```bash
curl -fsSL https://raw.githubusercontent.com/waitdeadai/claudemax/main/setup.sh | bash
```

## Authenticate

For Claude Max users (recommended):

```bash
# Just be logged into Claude Code interactive (claude --version should work)
# claudemax routes all provider calls through @anthropic-ai/claude-agent-sdk
# which bills against your Agent SDK credit pool ($100 Max5x / $200 Max20x).
```

Or API key fallback:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CMAX_PLAN=api
```

## First check

```bash
cmax doctor
```

You should see:
- plan: max5x or max20x (auto-detected)
- billing: subscription
- credit: $100/mo or $200/mo
- parallel cap with hardware + credit-aware bounds

## Install dark-patterns hooks (recommended)

```bash
claude plugin marketplace add waitdeadai/claude-plugins
claude plugin install llm-dark-patterns@waitdeadai-plugins
```

## First run — ask and achieve

In any project directory:

```bash
cmax ask "add a /health endpoint that returns build sha and uptime; cover with a test"
```

That is the entire daily-driver UX. No flags, no model picker, no decomposition by hand.

The SOTA-2026 pipeline runs automatically:

1. **`/deepresearch`** the topic. Sonnet collects sources in parallel; Opus synthesizes. Source ledger persisted to `memory.research_sources`.
2. **multispec decompose** — Opus authors N sub-Specs with a DAG of dependencies, rollup completion conditions, and per-sub-Spec write-sets.
3. **`/specqa`** (parallel) — Haiku checks each sub-Spec has mechanically-checkable verifyHints.
4. **`/introspect`** (parallel) — Opus rates confidence per sub-Spec; blocks at confidence < 6.
5. **Mode auto-selection** — Mode A (SDK subagents in one `query()`) for ≤ 5 sub-Specs / short runs; Mode B ([Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) with shared task list + worktree isolation) for big swarms or write-set overlap.
6. **Parallel `/goal`** per DAG leaf — Sonnet executes by default; Opus on router escalations (security, novelty, complexity ≥ 7).
7. **Per-sub-Spec `/verify`** (parallel) — blind Opus re-reads repo and runs each verifyHint.
8. **Rollup `/verify`** — blind Opus checks the integration conditions across all sub-Spec outputs.
9. **Memory record** + state snapshot. ntfy.sh push to phone if `NTFY_TOPIC` is set.

Throughout: bundled [dark-patterns hooks](https://github.com/waitdeadai/llm-dark-patterns) (35 of them, wired by `cmax init`) block vibes, fake citations, aggregator hallucination, and credential leaks.

Power-user flags (same engine; `cmax ask` is the friendly entry point):

```bash
cmax run "<goal>" --variant opusolo    # all-Opus exec for novel/security/auth work (~3× cost, max effectiveness)
cmax run "<goal>" --mode teams         # force Claude Code Agent Teams (Mode B) parallelism
cmax run "<goal>" --no-research        # skip /deepresearch for simpler / well-known goals
cmax run "<goal>" --no-verify          # skip independent verification (not recommended)
cmax run "<goal>" --max-turns 80       # cap each sub-Spec's /goal loop
```

This will:

1. /deepresearch (web-current sourced research, persisted to memory.research_sources)
2. multispec decompose (Opus → N sub-Specs + DAG + rollup conditions)
3. /specqa each sub-Spec (Haiku quality gate)
4. /introspect each sub-Spec (Opus confidence/assumption gate)
5. Auto-select Mode A or Mode B parallelism
6. parallel /goal per DAG leaf (Sonnet executes by default; Opus on router escalations)
7. per-sub-Spec /verify (parallel, blind Opus)
8. rollup /verify (blind Opus against rollup conditions)
9. Memory record + state snapshot

## Bootstrap taste (recommended on new projects)

```bash
cd my-project
cmax taste init
```

Auto-derives `taste.md` + `taste.vision` from repo signals + /deepresearch on SOTA at current time. NO 10 questions. ~30–90 seconds.

## Install skills into a project

```bash
cd my-project
cmax init                              # writes .claude/skills/* + .claude/hooks/*
```

Now inside Claude Code:

```
/cmax migrate the user model to drizzle, preserve all reads, ship tests
```

## Inspect routing decisions

```bash
cmax route "refactor the auth middleware" --complexity 6 --domain auth
# → tier:opus, escalated:true (security domain)

cmax route "summarize 500 commit messages"
# → tier:haiku

cmax route "design the cache layer" --tier opus --cost-ceiling 2
```

## Inspect memory

```bash
cmax memory search "auth migration"
cmax memory runs --limit 20
```

## Common patterns

### Cost-capped run

```bash
cmax run "<task>" --max-turns 80               # cap goal loop per sub-Spec
cmax doctor                                    # confirm budget headroom first
```

### Force /opusolo (all-Opus, max effectiveness)

```bash
cmax run "<task>" --variant opusolo
```

### Force Mode B (Claude Code Agent Teams) on a small task for testing

```bash
cmax run "<task>" --mode teams
```

### Goal only (skip spec writing if SPEC.md exists)

```bash
cmax goal SPEC.md
```

### Verify a prior run

```bash
cmax verify SPEC.md
```

### Long-running overnight

```bash
cmax overnight SPEC.md --budget-credits 50
# SIGTERM-safe: re-run picks up from last checkpoint
```

### Research a topic without running anything

```bash
cmax research "AI SDK v6 + Vercel AI Gateway + Claude Agent SDK integration patterns"
```

## What can go wrong

- **`cmax doctor` shows `plan: max5x source: default`** → auto-detect failed. Set `CMAX_PLAN=max20x` (or whatever you actually have) in your shell.
- **First `cmax run` fails with "no API key"** → you're on the API path. Either set `ANTHROPIC_API_KEY` or `claude login` first.
- **Mode B sub-Specs fail with "command not found"** → Claude Code CLI not on PATH; `which claude` to confirm. Fallback to `--mode solo` (Mode A).
- **/goal hits max-turns** → either the SPEC is unbounded or the task genuinely needs more turns. Re-spec or raise `--max-turns`.
- **/verify returns partial or failed** → iterate /goal against the failing conditions; re-verify. If two iterations don't move it, the SPEC is wrong — re-spec, don't re-grind.

## What this is not

- Not a chatbot wrapper.
- Not a multi-provider abstraction.
- Not autonomy without a SPEC.
- Not "Opus for everything" or "cheap for everything." Effectiveness max, cost-aware.
