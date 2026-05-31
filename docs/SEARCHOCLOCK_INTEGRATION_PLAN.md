# Search o'Clock integration plan

**Status: plan — not yet implemented.** Authoritative build contract for wiring the
`searchoclock` plugin (v0.3.0, `waitdeadai/searchoclock`) into claudemax. Reconciled
against the existing `vendor/llm-dark-patterns` sibling pattern, the `grounding-layer`
merge, and the hard working rules in `CLAUDE.md`.

Date: 2026-05-31. Research ledger embedded inline with citations + access dates.

---

## 0. What searchoclock is (audit summary)

A Claude Code **plugin** (`.claude-plugin/{plugin.json,marketplace.json}`) whose payload is
one 38 KB bash+python3 hook (`searchoclock.sh`) plus two subagents
(`searchoclock-researcher`, `searchoclock-validator`) and a `/searchoclock` command. On a
**Bash command failure** it injects date-anchored deep-research troubleshooting context and
dispatches a clean-context researcher subagent that probes the solution space against live,
dated sources; an **independent second model** (Haiku 4.5) must agree from the raw evidence
before the fix is trusted.

- **Deps:** bash + python3 ONLY. Fail-open (`exit 0`) if python3 absent; the hook NEVER
  blocks the agent loop — it injects `hookSpecificOutput.additionalContext`.
- **Triggers:** `PostToolUseFailure(Bash)` PRIMARY + `PostToolUse(Bash)` DEFENSIVE
  (self-gates on a real failure signal: `exit_code!=0` / `is_error` / `interrupted` / `error`)
  + OPT-IN `PreToolUse(Bash)` preflight (`SEARCHOCLOCK_PROACTIVE=0` default → no-op).
- **Already claudemax-aware:** `searchoclock.sh:435` and `commands/searchoclock.md:30` —
  *"if `.claudemax/memory.sqlite` exists, look up signature in `errors_solutions` first and
  record the chosen fix afterward; if `plan-detection.json` exists, respect the remaining
  credit budget."* Our `errors_solutions` schema
  (`packages/memory/src/schema.ts:32` — `signature / error / solution / context` + grounding
  columns) is exactly what it expects. It also scans `.claudemax/state/agent-teams-*/*.SPEC.md`
  for goal scope (`searchoclock.sh:316-320`).
- **Validator contract (Anthropic-only by default):**
  `SEARCHOCLOCK_VALIDATOR_MODEL=claude-haiku-4-5-20251001`,
  escalate `SEARCHOCLOCK_VALIDATOR_ESCALATE_MODEL=claude-sonnet-4-6`,
  `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER=''` (EMPTY).
- **Concurrency:** `SEARCHOCLOCK_MAX_GLOBAL=24`, `SEARCHOCLOCK_WORKFLOW_TEAM_SIZE=2`.

---

## 1. Consumption decision: **HYBRID** (vendor the hook + copy de-namespaced agents/command)

> **Decision:** Vendor `searchoclock.sh` exactly like `llm-dark-patterns` (gitignored
> `vendor/searchoclock/`, fetched by a sync script + setup.sh, wired via a discovery wrapper
> `.claude/hooks/soc.sh`), **AND** copy the two agents + the `/searchoclock` command into THIS
> repo's first-party plugin dirs **de-namespaced** (`.claude/agents/searchoclock-researcher.md`,
> `.claude/agents/searchoclock-validator.md`, `.claude/commands/searchoclock.md`), reconciling
> every hard-coded `searchoclock:` reference in the vendored hook + command to bare names.

### Why hybrid and not pure marketplace-plugin

Pure marketplace-install (`/plugin marketplace add waitdeadai/searchoclock` →
`/plugin install searchoclock@searchoclock`) is the *natively cleanest* path for agent/hook
resolution (research topic 1, confidence high — `code.claude.com/docs/en/discover-plugins.md`,
`/plugins.md`, `/plugin-marketplaces.md`, accessed 2026-05-31). But it **violates this repo's
established sibling convention**: claudemax does not marketplace-install `llm-dark-patterns`
either — it vendors it (`vendor/` is gitignored, fetched by `dark-patterns:sync` + `setup.sh`,
wrapped by `.claude/hooks/dp.sh`). Two reasons that convention exists apply identically here:

1. **Offline-first + audit trail.** The harness must function for a Max subscriber who clones
   the repo and runs `pnpm install` without first registering an external marketplace. The
   hook is advisory; vendoring keeps the dependency local and reviewable before merge.
2. **`cmax init` fan-out.** Dark-patterns hooks get copied into *target* projects by
   `cmax init`. searchoclock should ride the same rail so a `cmax init`-ed project gets the
   failure-research hook too, without that project needing its own marketplace registration.

### Why not pure vendor-and-copy

The vendor pattern alone **breaks the `searchoclock:` namespace**. Research topic 1 (high
confidence, `code.claude.com/docs/en/plugins.md`, `/plugins-reference.md`): plugin-namespaced
agents like `searchoclock:searchoclock-researcher` resolve *only* when the plugin is installed
via `/plugin install` (the prefix derives from `.claude-plugin/plugin.json:name`). The
injected protocol in `searchoclock.sh` (lines 414, 456, 528) and `commands/searchoclock.md:37`
dispatch the researcher/validator by their **namespaced** names. If we vendor without copying
+ de-namespacing, those `Agent(searchoclock:...)` dispatches resolve to nothing, the double-
validation gate silently never runs, and the integration degrades to "inject context only."

### The hybrid resolution

- **Vendor** the *hook script* (the part that matches dp.sh discipline — gitignored, fetched,
  wrapped).
- **Copy + de-namespace** the *agents and command* into the repo's own first-party
  `.claude/agents/` and `.claude/commands/` (which are committed, like `grounded-worker.md`),
  so bare `searchoclock-researcher` / `searchoclock-validator` resolve as project-level agents
  (research topic 1: standalone `.claude/agents/<name>.md` resolve as plain skill names).
- **Reconcile** the hard-coded `searchoclock:` references in the *vendored* hook + the *copied*
  command to bare names via a post-fetch `sed` step in the sync script (so re-fetching upstream
  re-applies the de-namespacing deterministically; we never hand-edit the vendored file and let
  it drift).

This mirrors exactly how the grounding-layer landed `grounded-worker.md` as a committed
first-party agent while keeping the vendored dark-patterns hooks discovery-wrapped.

---

## 2. The discovery wrapper — `.claude/hooks/soc.sh` (NEW, committed)

Analogous to `dp.sh`. searchoclock's plugin `hooks.json` calls
`bash ${CLAUDE_PLUGIN_ROOT}/searchoclock.sh`; the manual `settings.example.json` calls
`bash "$CLAUDE_PROJECT_DIR/.claude/hooks/searchoclock.sh"`. We do neither directly — we
discover the vendored copy, matching dp.sh's order. The wrapper passes through the optional
`preflight` arg and forwards stdin (the hook reads the tool-result JSON from stdin).

```bash
#!/usr/bin/env bash
# claudemax — searchoclock hook wrapper (sibling of dp.sh).
# Locates the vendored searchoclock.sh regardless of where it lives on disk, then
# execs it with any passed args (e.g. "preflight") and the hook's stdin intact.
# Discovery order:
#   1. CLAUDEMAX_SOC_DIR env (explicit override)
#   2. CLAUDE_PLUGIN_ROOT/searchoclock.sh (claudemax installed via marketplace, sibling vendored)
#   3. walk up from $PWD looking for vendor/searchoclock/searchoclock.sh
#   4. ~/.claudemax/vendor/searchoclock/searchoclock.sh (default install location)
#   5. <this script's dir>/searchoclock/searchoclock.sh (per-project vendored copy via cmax init)
# If none found, exit 0 silently (advisory hook; harness must keep working without it).
set -euo pipefail

discover_soc() {
  if [ -n "${CLAUDEMAX_SOC_DIR:-}" ] && [ -f "$CLAUDEMAX_SOC_DIR/searchoclock.sh" ]; then
    printf '%s' "$CLAUDEMAX_SOC_DIR/searchoclock.sh"; return
  fi
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$CLAUDE_PLUGIN_ROOT/vendor/searchoclock/searchoclock.sh"; return
  fi
  local cur="${PWD:-$(pwd)}"
  while [ "$cur" != "/" ] && [ -n "$cur" ]; do
    if [ -f "$cur/vendor/searchoclock/searchoclock.sh" ]; then
      printf '%s' "$cur/vendor/searchoclock/searchoclock.sh"; return
    fi
    cur="$(dirname "$cur")"
  done
  if [ -f "$HOME/.claudemax/vendor/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$HOME/.claudemax/vendor/searchoclock/searchoclock.sh"; return
  fi
  local self_dir; self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$self_dir/searchoclock/searchoclock.sh" ]; then
    printf '%s' "$self_dir/searchoclock/searchoclock.sh"; return
  fi
  printf '%s' ''
}

SOC="$(discover_soc)"
[ -z "$SOC" ] && exit 0
# Tell the hook where the project root is so it finds .claudemax/memory.sqlite + .searchoclock/.
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD:-$(pwd)}}"
exec bash "$SOC" "$@"
```

Note vs dp.sh: searchoclock takes a positional `preflight` arg and reads tool JSON from
stdin, so the wrapper uses `exec ... "$@"` (no `shift`) and does not consume stdin. The CLAUDE_PLUGIN_ROOT
branch points at `…/vendor/searchoclock/` (the consuming plugin is claudemax; the vendored sibling sits under its root).

---

## 3. Exact `.claude/settings.json` additive edits (ADDITIVE ONLY)

Discipline = the freshness-gate precedent: **preserve every existing hook / permission / env
verbatim**; only append. Three NEW top-level hook keys (`PostToolUseFailure`) plus additions
to the existing `PostToolUse` and `PreToolUse` arrays, plus four permission `allow` entries.

### 3a. `permissions.allow` — append four entries (after `"WebFetch"`)

```jsonc
// existing entries unchanged; APPEND:
"WebFetch(domain:*)",
"Agent(searchoclock-researcher)",
"Agent(searchoclock-validator)"
```

`WebSearch` + `WebFetch` are already allowed (settings.json:17-18). The plugin's
`settings.example.json:70-78` allows `WebFetch(domain:*)` and the two agents; because we
**de-namespace** (section 5), the `Agent(...)` permission entries use **bare** names
`searchoclock-researcher` / `searchoclock-validator`, NOT `searchoclock:searchoclock-researcher`.
This is the load-bearing reconciliation: workflow / background agents stall on a mid-run prompt
unless the researcher/validator agents are pre-allowed (`settings.example.json:29-30,71`).

### 3b. NEW top-level `PostToolUseFailure` key — PRIMARY trigger

`PostToolUseFailure` is a real, distinct, current event that fires on non-zero Bash exit
(research topic 2, high confidence: `code.claude.com/docs/en/hooks` + `anthropics/claude-code#24908`,
accessed 2026-05-31). The repo's settings.json has no `PostToolUseFailure` key today, so this
is a clean additive insert (place it after the existing `PostToolUse` block, before `TaskCreated`):

```jsonc
"PostToolUseFailure": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "bash .claude/hooks/soc.sh", "timeout": 8 }
    ]
  }
],
```

### 3c. Existing `PostToolUse` array — append a `Bash` matcher block (DEFENSIVE secondary)

The current `PostToolUse` has only an `Edit|Write|MultiEdit|NotebookEdit` block
(settings.json:109-116). Append a **new sibling object** with `matcher: "Bash"` — do NOT touch
the existing one. searchoclock self-gates here (only fires on a real failure signal), so the
double-registration is idempotent (research topic 2: `exit 0` on both, side-effect injection only):

```jsonc
// inside "PostToolUse": [ ... ], append:
{
  "matcher": "Bash",
  "hooks": [
    { "type": "command", "command": "bash .claude/hooks/soc.sh", "timeout": 8 }
  ]
}
```

### 3d. Existing `PreToolUse` array — append a `Bash` matcher block (OPT-IN preflight)

The current `PreToolUse` has a `Bash` matcher running `dp.sh no-vibes.sh` (settings.json:95-100).
Multiple hooks under one event run independently, so append a **new sibling object** (keeping
the no-vibes one untouched). The preflight is a **no-op unless `SEARCHOCLOCK_PROACTIVE=1`** — the
hook early-returns `exit 0` when PROACTIVE is off (`searchoclock.sh:594`), so registering it is
free and stays off by default (rule 6 / working-rule alignment):

```jsonc
// inside "PreToolUse": [ ... ], append a new object:
{
  "matcher": "Bash",
  "hooks": [
    { "type": "command", "command": "bash .claude/hooks/soc.sh preflight", "timeout": 5 }
  ]
}
```

### 3e. `env` — append searchoclock defaults (tuned for a Max, workflow-heavy harness)

Append to the existing `env` block (settings.json:22-25, currently `CLAUDEMAX_REPO` +
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`). Rationale per knob in section 6:

```jsonc
"SEARCHOCLOCK_ENABLE": "1",
"SEARCHOCLOCK_PROACTIVE": "0",
"SEARCHOCLOCK_VALIDATE": "1",
"SEARCHOCLOCK_VALIDATOR_MODEL": "claude-haiku-4-5-20251001",
"SEARCHOCLOCK_VALIDATOR_ESCALATE_MODEL": "claude-sonnet-4-6",
"SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER": "",
"SEARCHOCLOCK_VALIDATE_MIN_CONFIDENCE": "4",
"SEARCHOCLOCK_SEVERITY_MIN": "medium",
"SEARCHOCLOCK_COOLDOWN_SEC": "900",
"SEARCHOCLOCK_MAX_PER_SESSION": "8",
"SEARCHOCLOCK_MAX_GLOBAL": "24",
"SEARCHOCLOCK_WORKFLOW_TEAM_SIZE": "2"
```

> **Hard rule (working rule #1 / reconciliation rule 1):** `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER`
> stays the empty string. Both validator models are Anthropic-native (Haiku 4.5 / Sonnet 4.6).
> NEVER wire a non-Anthropic verifier. The empty-string default IS the Anthropic-only contract
> (research topic 2, high confidence). A guard test (section 8) asserts it stays empty.

---

## 4. `vendor/` + sync + setup/install (matches dark-patterns rails exactly)

`vendor/` is gitignored (`.gitignore:22`), so the committed artifacts are: the wrapper
(`soc.sh`), the settings.json registration, the copied/de-namespaced agents + command, the
sync script, the setup/install clause, and docs. The vendored `searchoclock.sh` itself is
FETCHED, not committed — exactly like `vendor/llm-dark-patterns/`.

### 4a. `package.json` — NEW `searchoclock:sync` script (mirrors `dark-patterns:sync`)

Add alongside the existing `dark-patterns:sync` (package.json:19). The clone step mirrors
dark-patterns; the extra step de-namespaces the fetched hook + command so bare agent names
resolve (section 5). Idempotent: re-fetch + re-`sed` is deterministic.

```jsonc
"searchoclock:sync": "([ -d vendor/searchoclock/.git ] && git -C vendor/searchoclock pull --ff-only || (mkdir -p vendor && git clone --depth 1 https://github.com/waitdeadai/searchoclock.git vendor/searchoclock)) && node scripts/soc-denamespace.mjs"
```

### 4b. `scripts/soc-denamespace.mjs` (NEW, committed) — reconcile the namespace

The injected protocol hard-codes `searchoclock:searchoclock-researcher` /
`searchoclock:searchoclock-validator` (searchoclock.sh:414,456,528; command:37). Under
vendoring those won't resolve (research topic 1, high confidence). This post-fetch step
rewrites the **vendored** `searchoclock.sh` in place to emit bare agent names, and copies the
**de-namespaced** command into `.claude/commands/`. Deterministic + re-runnable (it operates on
the freshly-cloned upstream each time, so no drift):

```js
// scripts/soc-denamespace.mjs  (Node, ES module — repo is "type":"module")
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
const SOC = "vendor/searchoclock";
if (!existsSync(`${SOC}/searchoclock.sh`)) { console.warn("  hint: searchoclock not vendored"); process.exit(0); }
const denamespace = (s) =>
  s.replaceAll("searchoclock:searchoclock-researcher", "searchoclock-researcher")
   .replaceAll("searchoclock:searchoclock-validator",  "searchoclock-validator");
// 1) rewrite the vendored hook in place (injected protocol dispatches bare names)
writeFileSync(`${SOC}/searchoclock.sh`, denamespace(readFileSync(`${SOC}/searchoclock.sh`, "utf8")));
// 2) refresh the committed first-party agents + command from upstream, de-namespaced
mkdirSync(".claude/commands", { recursive: true });
for (const [src, dst] of [
  [`${SOC}/agents/searchoclock-researcher.md`, ".claude/agents/searchoclock-researcher.md"],
  [`${SOC}/agents/searchoclock-validator.md`,  ".claude/agents/searchoclock-validator.md"],
]) writeFileSync(dst, denamespace(readFileSync(src, "utf8")));
writeFileSync(".claude/commands/searchoclock.md", denamespace(readFileSync(`${SOC}/commands/searchoclock.md`, "utf8")));
console.log("  ok    searchoclock de-namespaced (hook + agents + command)");
```

> The agents/command are committed (they live under `.claude/`, NOT `vendor/`), so on a clean
> clone they're already present even before `searchoclock:sync` runs. The sync step *refreshes*
> them from upstream + de-namespaces; it never deletes them. This is the one place the hybrid
> deviates from pure dark-patterns vendoring, and it's the deliberate fix for the namespace
> resolution gap.

### 4c. `package.json` `postinstall` — DO NOT BREAK (keep warn-only/non-fatal)

The postinstall was just fixed to be warn-only (package.json:20). **Do not make it fatal.**
Extend the existing hint with a second, identical-shape warn for searchoclock — single Node
`-e` with `|| true` preserved so a missing vendor never fails `pnpm install`:

```jsonc
"postinstall": "node -e \"const{existsSync}=require('fs');if(!existsSync('vendor/llm-dark-patterns'))console.warn('  hint: run: pnpm dark-patterns:sync (bundles llm-dark-patterns hooks)');if(!existsSync('vendor/searchoclock'))console.warn('  hint: run: pnpm searchoclock:sync (bundles the failure-research hook)');\" || true"
```

### 4d. `setup.sh` — tiered-install clause (mirrors the dark-patterns block, setup.sh:190-205)

Insert after the dark-patterns vendor block, gated by a new `--skip-searchoclock` flag (mirror
`--skip-dark-patterns`, setup.sh:35,45). Non-fatal (`warn` on failure), runs the de-namespace
step, never aborts install:

```bash
head "bundle searchoclock (waitdeadai — date-aware failure research hook)"
if [ "$SKIP_SEARCHOCLOCK" = true ]; then
  warn "skipped (--skip-searchoclock); the PostToolUseFailure research hook will not be wired"
elif [ -d "$INSTALL_DIR/vendor/searchoclock/.git" ]; then
  git -C "$INSTALL_DIR/vendor/searchoclock" pull --ff-only --quiet 2>/dev/null || true
  ( cd "$INSTALL_DIR" && node scripts/soc-denamespace.mjs ) || true
  ok "updated vendor/searchoclock"
else
  mkdir -p "$INSTALL_DIR/vendor"
  if git clone --depth 1 https://github.com/waitdeadai/searchoclock.git "$INSTALL_DIR/vendor/searchoclock" 2>/dev/null; then
    ( cd "$INSTALL_DIR" && node scripts/soc-denamespace.mjs ) || true
    ok "cloned vendor/searchoclock"
  else
    warn "searchoclock clone failed (offline?); run later: pnpm searchoclock:sync"
  fi
fi
```

Also add `--skip-searchoclock) SKIP_SEARCHOCLOCK=true; shift ;;` to the flag parser and
`SKIP_SEARCHOCLOCK=false` to the defaults block, and add a one-line note to the help header.

> **python3 note:** setup.sh:111 already warns (not errs) when python3 is missing. searchoclock
> fail-opens without python3 (`searchoclock.sh:42-44`), so no new preflight is required — the
> existing warn covers it.

### 4e. `install.sh` — same clause (mirror install.sh:104-115)

The local installer also vendors dark-patterns unconditionally. Add the same searchoclock
clone + de-namespace block right after it. Keep it non-fatal (`|| true`, `warn` on clone fail).
No new flag needed (install.sh has no `--skip-dark-patterns`); keep parity by making it
unconditional like the dark-patterns block.

---

## 5. How the researcher / validator agents resolve (the namespace reconciliation)

- **Copy** `searchoclock/agents/searchoclock-researcher.md` and
  `searchoclock-validator.md` into `.claude/agents/` (committed, sibling of
  `grounded-worker.md`). Their frontmatter `name:` fields are already bare
  (`searchoclock-researcher`, `searchoclock-validator`) and their `model:` lines are
  Anthropic-native (`sonnet` / `claude-haiku-4-5-20251001`) — no edit needed there.
- **Copy** `searchoclock/commands/searchoclock.md` into `.claude/commands/` (NEW dir; the repo
  has no `.claude/commands/` yet — `mkdir -p` in the de-namespace script handles it). Its
  frontmatter `agent: searchoclock-researcher` is already bare; only the body's
  `searchoclock:searchoclock-validator` reference (line 37) needs de-namespacing.
- **De-namespace** every `searchoclock:searchoclock-{researcher,validator}` occurrence in the
  vendored `searchoclock.sh` (lines 414, 456, 528) and the copied command (line 37) → bare
  names, via `scripts/soc-denamespace.mjs` (section 4b). This is mandatory: research topic 1
  (high confidence) + the explicit pitfall *"Hook references to plugin-namespaced agents will
  NOT auto-resolve if the hook is executed from a non-plugin context (.claude/settings.json)."*
- **Permission entries** (section 3a) therefore use bare `Agent(searchoclock-researcher)` /
  `Agent(searchoclock-validator)`.

`plugin.json` already advertises `"agents": "./agents"` but no root `agents/` exists today —
the live agents are under `.claude/agents/`. Keep the new searchoclock agents in
`.claude/agents/` to match `grounded-worker.md`; do not resurrect a root `agents/` dir. (If a
future cleanup points `plugin.json.components.agents` at `./.claude/agents`, that's a separate
change and out of scope here.)

---

## 6. Env defaults — rationale (Max subscriber, workflow-heavy)

| Knob | Value | Why |
|---|---|---|
| `SEARCHOCLOCK_ENABLE` | `1` | On by default; the failure-research loop is the point. |
| `SEARCHOCLOCK_PROACTIVE` | `0` | **Stays off** (reconciliation rule 6). Preflight is a no-op until opted in; avoids nagging on every Bash call. |
| `SEARCHOCLOCK_VALIDATE` | `1` | Double-validation gate on — it's the safety story; cheap (Haiku). |
| `SEARCHOCLOCK_VALIDATOR_MODEL` | `claude-haiku-4-5-20251001` | Anthropic-native independent verifier. |
| `SEARCHOCLOCK_VALIDATOR_ESCALATE_MODEL` | `claude-sonnet-4-6` | Anthropic-native escalation on low confidence. |
| `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER` | `""` | **EMPTY — hard Anthropic-only rule.** |
| `SEARCHOCLOCK_VALIDATE_MIN_CONFIDENCE` | `4` | Plugin default; ADOPT only at ≥4/5. |
| `SEARCHOCLOCK_SEVERITY_MIN` | `medium` | Raised from plugin default `low`: a Max, workflow-heavy harness sees many transient Bash hiccups; only research medium+ severity to keep signal high and pool consumption low (cf. memory: "don't fire heavy asks 4-wide / pool saturation"). |
| `SEARCHOCLOCK_COOLDOWN_SEC` | `900` | Per-signature dedup (plugin default) — don't re-research the same error within 15 min. |
| `SEARCHOCLOCK_MAX_PER_SESSION` | `8` | Plugin default ceiling per session. |
| `SEARCHOCLOCK_MAX_GLOBAL` | `24` | Cross-agent ceiling — safe for Opus 4.8 dynamic workflows / parallel agents. |
| `SEARCHOCLOCK_WORKFLOW_TEAM_SIZE` | `2` | High-severity fan-out inside a workflow/subagent; conservative for pool budget. |

All other knobs (`MIN_INTERVAL_SEC=60`, `TEAM_SIZE=3`, `SOLUTION_MODE=durable`,
`MIN_CANDIDATES=3`, `PROBE_ALL=1`, `GOAL_SCOPE=auto`, `STATE_DIR=$CLAUDE_PROJECT_DIR/.searchoclock`)
keep their plugin defaults — no override needed.

> `.searchoclock/` (the hook's state dir) and `vendor/` should be gitignored. `vendor/` already
> is (`.gitignore:22`); add `.searchoclock/` to `.gitignore` (the hook writes `last-error.md` +
> `state.json` there).

---

## 7. The closed loop — errors_solutions ↔ grounding layer (document the synergy)

This is the payoff the `GROUNDING_LAYER_PLAN.md` design anticipated. searchoclock is the
**writer**; the grounding layer is the **reader** — and the loop closes through one shared
table, `errors_solutions` (`packages/memory/src/schema.ts:32`).

```
Bash fails
  └─> PostToolUseFailure → soc.sh → searchoclock.sh
        ├─ reads .claudemax/memory.sqlite → errors_solutions (signature lookup FIRST)   [searchoclock.sh:435]
        ├─ if miss: researcher probes live dated sources → validator (Haiku) must AGREE
        └─ records the chosen durable fix back into errors_solutions (signature/error/solution/context)
                                   │
                                   ▼
  later sub-Spec leaf spawns (Mode A SDK subagent OR Mode B teammate)
        └─> grounded-worker.md  →  mcp__memory__memory_search  →  errors_solutions row
              (the fix is now addressable, dated via last_verified_at, and freshness-gated)
```

- **Schema match (verified):** searchoclock expects `signature / error / solution / context`;
  `errors_solutions` has exactly those plus grounding columns (`last_verified_at`,
  `verified_count`) — so searchoclock-written rows are dated and participate in staleness
  the same as any grounded fact (`docs/grounding-layer.md`: "Age is part of the truth").
- **Reader side:** `grounded-worker.md` already lists `mcp__memory__memory_search` (which
  searches `errors_solutions`, see `packages/memory-mcp` table set) and `memory_stale`. No
  change to the worker contract is required — searchoclock simply populates the table that the
  worker already reads.
- **Plan/budget hand-off:** searchoclock reads `plan-detection.json` for remaining credit
  budget before fan-out (searchoclock.sh:435), aligning with the plan-aware cost-guard
  (working rule #10).
- **Anti-flooding alignment:** the grounding layer's contrarian rule ("more memory ≠ better
  grounding"; retrieval-on-demand, no dump-all) is preserved — searchoclock writes *one fix per
  signature* and the MCP pulls a small ranked slice, never a dump.

**One-line addition for `docs/grounding-layer.md`** under "The pieces":

> - **`vendor/searchoclock` (vendored hook) + `.claude/hooks/soc.sh`** — closes the write side
>   of the loop: on a Bash failure it records the validated durable fix into
>   `errors_solutions`, which `grounded-worker` later reads via `mcp__memory__memory_search`.
>   See `docs/searchoclock.md`.

---

## 8. Docs + repo-shape + working-rule edits

- **`docs/searchoclock.md` (NEW)** — orientation doc (mirrors `docs/grounding-layer.md` shape):
  what searchoclock is, the hybrid consumption decision + why, the soc.sh discovery order, the
  env table, the errors_solutions↔grounding closed loop, the Anthropic-only validator
  invariant, and the `/searchoclock` manual fallback (the command is the reliable path inside
  Opus 4.8 dynamic workflows where mid-run injection isn't visible — command:44).
- **`CLAUDE.md` — repository shape:** add `.claude/commands/` (NEW dir) and note the vendored
  `vendor/searchoclock` sibling alongside `vendor/llm-dark-patterns` in the
  `.claude/hooks/` / repo-shape bullets.
- **`CLAUDE.md` — NEW working rule** (append after rule 12, the closeout rule; or fold into the
  grounding section): *"searchoclock closes the errors_solutions loop. The vendored
  `searchoclock.sh` (PostToolUseFailure(Bash)) WRITES validated durable fixes; the grounding
  layer (`grounded-worker` + `mcp__memory__memory_search`) READS them. Its independent
  validator is Anthropic-only by hard rule: `SEARCHOCLOCK_VALIDATOR_CROSS_PROVIDER` stays empty;
  validator = Haiku 4.5, escalate = Sonnet 4.6. PROACTIVE preflight stays off by default."*
- **`CHANGELOG.md`** — new `### Added — 2026-05-31 searchoclock integration` entry under
  `[Unreleased]`, in the same prose style as the grounding-layer entry; enumerate: vendored
  hook + soc.sh wrapper, settings.json additive registration, de-namespaced agents/command,
  sync script + setup/install clause, env defaults, the closed-loop synergy.
- **`README.md`** — one line in the hooks/features section: failure-research hook with
  independent Anthropic-only validation, vendored like dark-patterns.
- **NOT a new skill.** `/searchoclock` is a *command* (`.claude/commands/`), not a catalog
  skill — it does not count against the lean 31-skill catalog and does not need a SKILL_CATALOG
  overlap audit (working rule #2). Note this explicitly in the changelog so a future
  `/harness-audit` doesn't flag it.

---

## 9. Build order + per-step file ownership (no two steps touch the same file)

| Step | Action | Files OWNED (created/edited) by this step |
|---|---|---|
| 1 | `.gitignore`: add `.searchoclock/` | `.gitignore` |
| 2 | Discovery wrapper | `.claude/hooks/soc.sh` (NEW) |
| 3 | De-namespace script | `scripts/soc-denamespace.mjs` (NEW) |
| 4 | Copy + de-namespace agents/command (run step 3 once locally, OR hand-place) | `.claude/agents/searchoclock-researcher.md` (NEW), `.claude/agents/searchoclock-validator.md` (NEW), `.claude/commands/searchoclock.md` (NEW) |
| 5 | npm scripts (`searchoclock:sync` + extend `postinstall` warn) | `package.json` |
| 6 | settings.json additive (perms + PostToolUseFailure + PostToolUse/PreToolUse Bash blocks + env) | `.claude/settings.json` |
| 7 | setup.sh clause + `--skip-searchoclock` flag | `setup.sh` |
| 8 | install.sh clause | `install.sh` |
| 9 | New orientation doc | `docs/searchoclock.md` (NEW) |
| 10 | Grounding-layer synergy line | `docs/grounding-layer.md` |
| 11 | Repo shape + working rule | `CLAUDE.md` |
| 12 | Changelog entry | `CHANGELOG.md` |
| 13 | README line | `README.md` |
| 14 | Guard test (asserts CROSS_PROVIDER empty + bare agent names + soc.sh discovery + settings additive) | `scripts/smoke.sh` (edit) and/or a new vitest in `packages/*` |

Each file is owned by exactly one step → safe to parallelize steps 1–4, 9–13 (distinct files);
steps 5–8 each own one infra file; step 14 reads-only the others. Steps 4 depends on 3 (the
script produces the de-namespaced agents); 7/8 depend on 3 (they call it). Step 6 (settings)
depends on 2 (the wrapper must exist for the hook command to resolve at runtime, though the
edit itself is independent).

**Sequence:** 1 → 2 → 3 → 4 → (5, 6 in parallel) → (7, 8 in parallel) → (9–13 in parallel) → 14.

---

## 10. Open risks

1. **`PostToolUseFailure` TUI noise.** Known cosmetic bug: the TUI shows "hook error" even on a
   clean `exit 0` with no stderr (research topic 2: `anthropics/claude-code#27886`, `#34713`).
   Functional impact nil, but it can confuse diagnostics. Document in `docs/searchoclock.md`;
   do not treat as a failure.
2. **Double-fire on Bash failure.** Both `PostToolUseFailure(Bash)` and the new
   `PostToolUse(Bash)` defensive block can fire on the same failure. searchoclock self-gates +
   is idempotent (`exit 0`, additionalContext injection, per-signature cooldown), so the risk
   is low — but verify one-shot application in an integration smoke run (research topic 2).
3. **Namespace drift on upstream change.** If upstream renames the agents or changes the
   `searchoclock:` dispatch strings, `scripts/soc-denamespace.mjs`'s `replaceAll` targets go
   stale silently. Mitigation: the guard test (step 14) greps the de-namespaced hook for any
   residual `searchoclock:` token and fails if found.
4. **Validator model availability / quota.** If Haiku 4.5 / Sonnet 4.6 are unavailable or
   pool-throttled, the validator subagent silently stalls (hook still `exit 0`, non-blocking,
   but the gate doesn't run → fix is presented un-validated as ESCALATE). Aligns with the
   pool-saturation memory; document that ESCALATE (not ADOPT) is the safe default.
5. **`cmax init` fan-out scope.** This plan wires searchoclock into *this repo's* settings.
   Whether `cmax init` should also copy soc.sh + the agents into *target* projects (like it does
   dark-patterns) is a follow-up — `init.ts` changes are explicitly OUT of scope here to avoid
   colliding with the dark-patterns init logic. Flag for a separate PR.
6. **`plan-detection.json` contract unverified.** searchoclock reads it for budget; this repo
   uses `resolveBillingEra()` / cost-guard in `packages/core/src/cost.ts`. Confirm whether a
   `plan-detection.json` is actually emitted anywhere, or whether the budget hand-off is a
   no-op today (likely forward-compat only, like the pre-split billing era). Low priority —
   searchoclock fail-opens if the file is absent.
7. **`WebFetch(domain:*)` breadth.** The plugin asks for `WebFetch(domain:*)`; the repo already
   allows bare `WebFetch`. Adding the domain-scoped form is harmless (superset already granted),
   but confirm it doesn't widen anything unexpectedly under `bypassPermissions`. Low risk.
8. **Marketplace path left on the table.** If distribution priorities change (publishing
   claudemax to a marketplace where searchoclock can be a declared plugin dependency), revisit
   the pure marketplace-plugin path — it has cleaner native resolution and auto-update
   (research topic 1). The hybrid is the right call *for this repo's current vendor convention*,
   not a permanent verdict.
