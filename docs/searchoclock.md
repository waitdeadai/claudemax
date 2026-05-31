# Search o'Clock

`searchoclock` is the **write side** of claudemax's error-grounding loop. When a Bash command fails, it injects date-anchored deep-research troubleshooting context, dispatches a clean-context researcher subagent that probes the solution space against live, dated sources, and requires an **independent second model** (Haiku 4.5) to agree from the raw evidence before a fix is trusted. The validated durable fix is recorded into `errors_solutions`, where the grounding layer later reads it.

The authoritative build contract is [`SEARCHOCLOCK_INTEGRATION_PLAN.md`](./SEARCHOCLOCK_INTEGRATION_PLAN.md). This doc is the short orientation; it mirrors [`grounding-layer.md`](./grounding-layer.md).

## What it is

A Claude Code **plugin** (upstream `waitdeadai/searchoclock`, v0.3.0) whose payload is one 38 KB bash+python3 hook (`searchoclock.sh`) plus two subagents (`searchoclock-researcher`, `searchoclock-validator`) and a `/searchoclock` command.

- **Deps:** bash + python3 ONLY. Fail-open (`exit 0`) if python3 is absent; the hook NEVER blocks the agent loop — it injects `hookSpecificOutput.additionalContext`.
- **Triggers:** `PostToolUseFailure(Bash)` PRIMARY + `PostToolUse(Bash)` DEFENSIVE (self-gates on a real failure signal: non-zero exit / `is_error` / `interrupted` / `error`) + an OPT-IN `PreToolUse(Bash)` preflight that is a no-op unless `SEARCHOCLOCK_PROACTIVE=1`.
- **Already claudemax-aware:** the hook looks up the error signature in `.claudemax/memory.sqlite` `errors_solutions` FIRST and records the chosen fix afterward; if `plan-detection.json` exists it respects the remaining credit budget.

## Consumption decision: HYBRID (vendor the hook + copy de-namespaced agents/command)

claudemax does not marketplace-install its siblings — it **vendors** them (gitignored `vendor/`, fetched by a sync script + `setup.sh`/`install.sh`, wrapped by a discovery script). `llm-dark-patterns` rides exactly this rail. searchoclock rides the same one, with one deliberate addition:

- **Vendor the hook.** `vendor/searchoclock/searchoclock.sh` is gitignored, fetched by `pnpm searchoclock:sync` (or `setup.sh`/`install.sh`), wrapped by `.claude/hooks/soc.sh`.
- **Copy + de-namespace the agents and command** into the repo's committed first-party dirs (`.claude/agents/searchoclock-researcher.md`, `.claude/agents/searchoclock-validator.md`, `.claude/commands/searchoclock.md`), sibling to `grounded-worker.md`.

### Why de-namespace

The upstream injected protocol dispatches the researcher/validator by their **plugin-namespaced** names (`searchoclock:searchoclock-researcher` / `:searchoclock-validator`). Those names resolve ONLY when searchoclock is installed via `/plugin install`. Under vendoring, the namespaced dispatch resolves to nothing and the double-validation gate silently never runs. `scripts/soc-denamespace.mjs` (run by the sync step) rewrites the **vendored hook** in place to emit BARE names and refreshes the committed agents + command from upstream, de-namespaced. The permission entries therefore use bare `Agent(searchoclock-researcher)` / `Agent(searchoclock-validator)`. The de-namespace step is deterministic and re-runnable (it operates on the freshly-cloned upstream each time, so the vendored file never drifts from a hand edit).

## The `soc.sh` discovery order

`.claude/hooks/soc.sh` (sibling of `dp.sh`) locates the vendored hook regardless of where it lives, then execs it with any passed args (`preflight`) and stdin intact (the hook reads the tool-result JSON from stdin):

1. `CLAUDEMAX_SOC_DIR` env (explicit override)
2. `CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh` (claudemax installed via marketplace, sibling vendored)
3. walk up from `$PWD` for `vendor/searchoclock/searchoclock.sh`
4. `~/.claudemax/vendor/searchoclock/searchoclock.sh` (default install location)
5. `<soc.sh dir>/searchoclock/searchoclock.sh` (per-project vendored copy)

If none are found it exits 0 silently — the hook is advisory and the harness must keep working without it.

## Env defaults (tuned for a Max, workflow-heavy harness)

Declared in `.claude/settings.json` `env`:

| Knob | Value | Why |
|---|---|---|
| `SEARCHOCLOCK_ENABLE` | `1` | On by default; the failure-research loop is the point. |
| `SEARCHOCLOCK_PROACTIVE` | `0` | **Stays off.** Preflight is a no-op until opted in; avoids nagging on every Bash call. |
| `SEARCHOCLOCK_VALIDATE` | `1` | Double-validation gate on — the safety story; cheap (Haiku). |
| `SEARCHOCLOCK_VALIDATOR_MODEL` | `claude-haiku-4-5-20251001` | Anthropic-native independent verifier. |
| `SEARCHOCLOCK_VALIDATOR_ESCALATE_MODEL` | `claude-sonnet-4-6` | Anthropic-native escalation on low confidence. |
| `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER` | `""` | **EMPTY — hard Anthropic-only rule.** |
| `SEARCHOCLOCK_VALIDATE_MIN_CONFIDENCE` | `4` | ADOPT only at ≥4/5. |
| `SEARCHOCLOCK_SEVERITY_MIN` | `medium` | Raised from upstream `low`: a workflow-heavy harness sees many transient Bash hiccups; research only medium+ severity to keep signal high and pool consumption low. |
| `SEARCHOCLOCK_COOLDOWN_SEC` | `900` | Per-signature dedup — don't re-research the same error within 15 min. |
| `SEARCHOCLOCK_MAX_PER_SESSION` | `8` | Per-session ceiling. |
| `SEARCHOCLOCK_MAX_GLOBAL` | `24` | Cross-agent ceiling — safe for Opus 4.8 dynamic workflows / parallel agents. |
| `SEARCHOCLOCK_WORKFLOW_TEAM_SIZE` | `2` | High-severity fan-out inside a workflow/subagent; conservative for pool budget. |

> **Anthropic-only invariant (working rule #1).** `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER` stays the empty string. Both validator models are Anthropic-native (Haiku 4.5 / Sonnet 4.6). NEVER wire a non-Anthropic verifier — the empty-string default IS the contract. The smoke guard asserts it stays empty.

All other knobs keep their upstream defaults (`MIN_INTERVAL_SEC=60`, `TEAM_SIZE=3`, `SOLUTION_MODE=durable`, `MIN_CANDIDATES=3`, `PROBE_ALL=1`, `GOAL_SCOPE=auto`, `STATE_DIR=$CLAUDE_PROJECT_DIR/.searchoclock`). `.searchoclock/` is gitignored.

## The closed loop — `errors_solutions` ↔ grounding layer

searchoclock is the **writer**; the grounding layer is the **reader**. The loop closes through one shared table, `errors_solutions` (`packages/memory/src/schema.ts`):

```
Bash fails
  └─> PostToolUseFailure → soc.sh → searchoclock.sh
        ├─ reads .claudemax/memory.sqlite → errors_solutions (signature lookup FIRST)
        ├─ if miss: researcher probes live dated sources → validator (Haiku) must AGREE
        └─ records the chosen durable fix back into errors_solutions (signature/error/solution/context)
                                   │
                                   ▼
  later sub-Spec leaf spawns (Mode A SDK subagent OR Mode B teammate)
        └─> grounded-worker.md → mcp__memory__memory_search → errors_solutions row
              (the fix is now addressable, dated via last_verified_at, and freshness-gated)
```

- **Schema match:** searchoclock expects `signature / error / solution / context`; `errors_solutions` has exactly those plus the grounding columns `last_verified_at` + `verified_count` — so searchoclock-written rows are dated and participate in staleness like any grounded fact ("age is part of the truth").
- **Reader side, no change needed:** `grounded-worker.md` already lists `mcp__memory__memory_search` (which searches `errors_solutions`) + `mcp__memory__memory_stale`. searchoclock simply populates the table the worker already reads.
- **Anti-flooding alignment:** searchoclock writes *one fix per signature*; the MCP pulls a small ranked slice, never a dump — consistent with the grounding layer's "more memory ≠ better grounding" rule.

## Manual fallback — `/searchoclock`

`/searchoclock [error]` runs the same date-aware troubleshooting on demand (forked researcher subagent, recommend-not-apply). Inside an Opus 4.8 **dynamic workflow** there is no mid-run user input and only the final answer reaches the session, so `/searchoclock` is the reliable manual path when in-session hook injection isn't visible. It is a *command*, not a catalog skill — it does not count against the lean skill catalog.

## Open risks

- **`PostToolUseFailure` TUI noise.** A known cosmetic bug shows "hook error" even on a clean `exit 0` with no stderr. Functional impact is nil; do not treat it as a failure.
- **Double-fire.** Both `PostToolUseFailure(Bash)` and the defensive `PostToolUse(Bash)` block can fire on the same failure. searchoclock self-gates + is idempotent (`exit 0`, additionalContext injection, per-signature cooldown), so the double-registration is safe.
- **Validator availability.** If Haiku 4.5 / Sonnet 4.6 are pool-throttled, the validator subagent stalls (the hook still `exit 0`s, non-blocking) and the fix is presented as ESCALATE rather than ADOPT — the safe default.
- **Namespace drift.** If upstream renames the agents or changes the dispatch strings, `scripts/soc-denamespace.mjs`'s `replaceAll` targets could go stale; the smoke guard greps the de-namespaced hook for any residual `searchoclock:` token and fails if found.
