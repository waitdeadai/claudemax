# claudemax skills

Drop these into `.claude/skills/` in any Claude Code project (via `cmax init`) for the lean 29-skill power-user catalog (27 active + 2 aliases). One additional directory (`/dispatch`) ships as a DEPRECATED stub for v1 muscle memory; the router should never pick it.

## Catalog

### Umbrellas (5) — daily drivers; each auto-runs the full pipeline

| Skill | Plan/judge | Sub-Spec /goal exec | Verify | Use |
|---|---|---|---|---|
| `/ask` | Opus | Sonnet | Opus | Canonical ask-and-achieve entry. `cmax ask "<goal>"` CLI equivalent |
| `/cmax` | Opus | Sonnet | Opus | Default daily-driver; brand umbrella |
| `/workflow` | Opus | Sonnet | Opus | Alias for /cmax (v1 muscle memory) |
| `/opussonnet` | Opus | Sonnet | Opus | v1 muscle memory; same engine |
| `/opusolo` | Opus | **Opus** | Opus | Max-effectiveness; auth/payments/novel-domain |

### Research (5)

| Skill | Purpose |
|---|---|
| `/deepresearch` | Sourced web-current research with ledger |
| `/audit` | Adversarial code-quality scan of existing code |
| `/investigate` | Multi-source root-cause analysis for a specific bug |
| `/codesearch` | Multi-pattern search with relevance ranking |
| `/introspect` | Confidence/assumption hard-gate (blocks /goal at <6) |

### Planning (2)

| Skill | Purpose |
|---|---|
| `/spec` | Author a single SPEC.md with measurable completion conditions |
| `/specqa` | Spec quality gate — every verifyHint must be mechanically checkable |

### Execution (8)

| Skill | Purpose |
|---|---|
| `/goal` | Autonomous /goal loop wrapping Claude Code's native validator-loop |
| `/tdd` | Strict write-failing-test-first → implement → verify-passes cycle. Opt-in via `cmax ask "<goal>" --tdd` |
| `/mega` | Session-limit-aware mega-build — N goals, auto-sized lanes from hardware × plan × free RAM, pauses on rate-limit saturation, resumable via `/resume`. Flagship for power users with many goals to ship. |
| `/resume` | Pick up a paused `/mega` run. cron-friendly (exits 0 on no-op). Wire into systemd timer for fully-unattended resume across rate-limit windows. |
| `/schedule` | SOTA-2026 reset-aware systemd-user-timer scheduler for `cmax` commands. Auto-discovers nvm/cargo PATH, dry-fires the target command BEFORE arming (catches missing-binary failures pre-flight), parses Anthropic rate-limit reset signals (RFC3339 + human "resets 3pm"), and auto-reschedules on session-limit hit. Subcommands: `run / list / status / cancel / test / parse-reset / path`. Built after the 2026-05-21 overnight cron lost a night to PATH+calendar bugs that this command exists to make impossible. |
| `/orchestrate` | Multi-goal harness — N parallel `cmax ask` pipelines for DIFFERENT goals; live status table + rollup verdict. No auto-sizing (use /mega for that). |
| `/parallel` | Distinct-packet fan-out (DispatchPlan) for ONE goal |
| `/hive` | Same problem N times → merge proposals |
| `/council` | 3-Opus adversarial debate (proposer / critic / judge) |

### Verification (3)

| Skill | Purpose |
|---|---|
| `/verify` | Blind independent Opus pass against SPEC completion conditions |
| `/review` | Diff review for proposed changes (correctness, security, style) |
| `/ship` | Final go/no-go combining /verify + /review |

### Memory & state (3)

| Skill | Purpose |
|---|---|
| `/memory` | Search/inspect persistent SQLite+FTS5 store |
| `/align` | One-shot semantic decision recorder → memory.decisions |
| `/overnight` | Long-running mode with file checkpointing + session resumption |

### Taste (2) — auto-bootstrap, NOT question-driven

| Skill | Purpose |
|---|---|
| `/taste` | Auto-bootstrap via /deepresearch (NO 10 questions) |
| `/deepretaste` | Drift detection vs current code |

### Infrastructure (5)

| Skill | Purpose |
|---|---|
| `/agentfactory` | Governed AgentDefinition creation + Hermes-style registry |
| `/route` | Inspect or override the model-routing decision |
| `/agentteams` | Manual invocation of Mode B (Claude Code Agent Teams) |
| `/harness-audit` | Periodic review of claudemax's own scaffolding against current Opus capability |
| `/cc-audit` | SOTA-2026 deepresearch-backed audit of new Claude Code CLI releases; verdict per change (IGNORE/WRAP/INTEGRATE/DEFER) so the harness never ships conflicting or redundant tools |

## Total: 32 active skills (5 umbrellas + 5 research + 2 planning + 6 execution + 3 verification + 3 memory + 2 taste + 5 infrastructure + 1 specqa porting addition = 32, includes new `/specqa` under Planning and new `/cc-audit` under Infrastructure landed 2026-05-22). Two of the 5 umbrellas (`/workflow`, `/opussonnet`) are explicit ALIAS-for-/cmax entries kept only for v1 muscle memory. One additional directory (`/dispatch`) ships as a DEPRECATED stub — router should skip; use `/parallel` or the CLI `cmax dispatch` instead.

Lean, audited for overlap. Cuts vs v1's 43-skill catalog: MiniMax-specific skills dropped entirely; /webresearch merged into /deepresearch; /autoplan into the multispec engine; /qa into /verify; /digestaste + /digestflow are internal runtime functions; /tastebootstrap replaced by auto-bootstrap /taste; product-specific skills (/defineicp /icpweek /claudeproduct etc.) deferred.

## Install

```bash
cmax init                          # writes .claude/skills/* + hooks + dark-patterns
cmax init --target /path/to/proj   # explicit target
cmax init --force                  # overwrite existing
```
