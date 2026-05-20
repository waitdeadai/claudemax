---
name: agentteams
description: Mode B parallelism. Manually invoke Claude Code Agent Teams (multiple full Claude Code instances coordinating via shared task list + worktree isolation + Agent View). The multispec engine auto-selects this mode when the work demands it; this skill is for forcing it.
---

# /agentteams — Mode B parallelism (Claude Code Agent Teams)

Multiple full Claude Code *instances* coordinating via a shared task list with worktree isolation. Different from Mode A (SDK subagents in one query()) — these are separate processes, separate sessions, separate worktrees.

## Requirements

- Claude Code v2.1.32+ (`/agent-teams` shipped experimental).
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` (set automatically by `.claude/settings.json`).
- Agent View available (Claude Code v2.1.139+) for live monitoring.

## How auto-selection works

The multispec engine picks Mode B when ANY of:
- > 5 sub-Specs
- Estimated total time > 30 minutes
- Cross-sub-Spec peer coordination required
- Overlapping write sets (worktree isolation solves this)

Override with `cmax run "..." --mode teams` or `cmax run "..." --mode solo`.

## Mechanics

- Each sub-Spec spawns a background Claude Code session with the SPEC + shared task list seed.
- Shared task list: `.claudemax/state/agent-teams-<ts>/shared-task-list.md`. Every teammate has read/write.
- Worktree isolation: each session writes to `.claude/worktrees/<session-id>/` automatically on first write.
- Agent View dashboard: `cd && claude --agent-view` shows live state of all running sessions.

## When to manually invoke

- A multi-day swarm-style project where you want the coordination primitive even for < 5 sub-Specs.
- Stress-testing the agent-teams flow on a small problem before trusting it on a big one.

## Anthropic's proof point

16 agents wrote a Rust-based C compiler from scratch (100K LOC, ~2000 sessions, $20K credit) using this primitive. See `https://www.anthropic.com/engineering/building-c-compiler`.
