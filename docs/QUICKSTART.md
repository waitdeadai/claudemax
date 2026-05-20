# Quickstart

## Install

```bash
git clone https://github.com/waitdeadai/claudemax ~/.claudemax
cd ~/.claudemax
pnpm install
pnpm build
sudo ln -sf $PWD/packages/cli/dist/index.js /usr/local/bin/cmax
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

## First run

In any project directory:

```bash
cmax run "add a /health endpoint that returns build sha and uptime; cover with a test"
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
