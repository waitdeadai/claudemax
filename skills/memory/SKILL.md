---
name: memory
description: Search and write to the persistent SQLite memory store. Use at session start to recall prior decisions, at session end to log episodes, and during work to query error-solution pairs and patterns.
---

# /memory — persistent memory

A SQLite+FTS5 store that survives sessions. Five tables:

- **episodes** — session start/end notes, run logs
- **decisions** — topic, decision, rationale (semantic memory)
- **errors_solutions** — error signature → fix (procedural memory)
- **patterns** — named recurring code patterns
- **runs** — full SPEC runs with status + cost

## When to use

- **Session start**: search the memory for the current task topic. Surface relevant decisions and prior failures before starting.
- **During work**: when you hit an error, search `errors_solutions`. If a match exists, apply it.
- **Session end**: record a `goal-run` episode with what changed and why. Record a decision if you made an architectural call. Record an error-solution if you debugged something non-obvious.

## What NOT to store

- Code itself (it's in git).
- Anything derivable from `git log`/`git blame`.
- Ephemeral conversation context.

Store *what was non-obvious or load-bearing.*

## CLI access

```bash
cmax memory search "auth migration"
cmax memory runs --limit 20
```
