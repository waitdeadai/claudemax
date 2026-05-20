# Mode B — Claude Code Agent Teams

Anthropic shipped Agent Teams as experimental in Claude Code v2.1.32 and Agent View (CLI dashboard) in v2.1.139 (May 11, 2026). This is a **fundamentally different parallelism primitive** from SDK subagents: multiple full Claude Code *instances* coordinating via a shared task list with worktree isolation per instance.

## When to use Mode B vs Mode A

Mode A (SDK subagents in one query()) is the default, lighter path. Mode B is for big swarms.

| Spec shape | Mode | Why |
|---|---|---|
| ≤ 5 sub-Specs, < 30 min total, no overlap | **Mode A** | Context-efficient; one orchestrator session |
| > 5 sub-Specs OR > 30 min OR cross-spec coordination OR overlapping write sets | **Mode B** | Worktree isolation; shared task list; Agent View dashboard |

The multispec engine picks automatically. Override with `cmax run "..." --mode {auto|solo|teams}`.

## Key properties

- **Shared task list** — every teammate has read/write access; coordination happens through the list, not orchestrator-mediated messages. Each teammate claims tasks, marks them done with evidence, raises blocking questions inline.
- **Direct peer communication** — teammates can challenge each other's work, share findings, ask each other questions without going through the lead.
- **Worktree isolation** — each background session auto-moves to `.claude/worktrees/<session-id>/` on first file write. 10 parallel sessions can read the same checkout but each writes to its own worktree. No same-file contention by design.
- **Background sessions + Agent View** — sessions can run in background; Agent View (`cd && claude --agent-view` or Ctrl+a in a claude session) surfaces which are running/blocked/done at a glance.

## Setup

```bash
# In your .claude/settings.json or shell:
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true

# Confirm Claude Code v2.1.32+:
claude --version
```

claudemax's `.claude/settings.json` sets this env var automatically.

## How claudemax wires Mode B

`packages/runtime/src/agent-teams.ts` drives the Mode B flow:

1. Writes per-sub-Spec SPEC.md files to `.claudemax/state/agent-teams-<ts>/<id>.SPEC.md`.
2. Generates a shared task list at `.claudemax/state/agent-teams-<ts>/shared-task-list.md` with the DAG, dependencies, and rollup conditions.
3. Spawns N background Claude Code sessions: `claude -p "<prompt referencing the SPEC + shared task list>" --dangerously-skip-permissions` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` in the env. (v0.2.1 flipped this from `--permission-mode acceptEdits` to match the harness-wide bypassPermissions default; override with `--permission default` if you need approval prompts per-edit.)
4. Polls each session for completion; aggregates per-sub-Spec status into the harness result.
5. Prints the Agent View invocation command at start so you can monitor live.

## Anthropic's proof point

16 agents wrote a Rust-based C compiler from scratch using Agent Teams: 100K LOC, ~2,000 Claude Code sessions, ~$20K credit. See [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler).

That same primitive is what claudemax uses for big multispec runs.

## When NOT to use Mode B

- Quick tasks (1–4 sub-Specs, < 20 min) — Mode A is faster and cheaper.
- Tightly-coupled work where every sub-Spec must consume the prior one's exact output — that's a dependency chain, not a parallel swarm.
- Local dev environments where spawning N background processes is disruptive — set `CMAX_PLAN=api` and bias toward Mode A.

## Limitations

- **Experimental flag** — Anthropic may change the interface. Pin Claude Code version in CI.
- **Agent View is CLI-only** — no web dashboard; in remote SSH sessions, use `tmux` or `screen` to keep it open.
- **Worktree disk usage** — each session uses ~N× the working tree size. Clean up old worktrees periodically: `claude worktree prune` or `rm -rf .claude/worktrees/<old-session-id>`.

## Cost shape

A 10-sub-Spec multispec run in Mode B with /opussonnet routing: ~$8–15 credit, ~3–5 hours wall-clock with 6 parallel teammates. Same scope sequentially: ~$8–15 credit but ~30+ hours.

The credit cost is the same; Mode B buys you wall-clock time, not money.
