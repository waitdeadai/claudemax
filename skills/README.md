# claudemax skills

Drop these into `.claude/skills/` in any Claude Code project (via `cmax init`) for the lean 26-skill power-user catalog.

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

### Execution (4)

| Skill | Purpose |
|---|---|
| `/goal` | Autonomous /goal loop wrapping Claude Code's native validator-loop |
| `/parallel` | Distinct-packet fan-out (DispatchPlan) |
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

### Infrastructure (3)

| Skill | Purpose |
|---|---|
| `/agentfactory` | Governed AgentDefinition creation + Hermes-style registry |
| `/route` | Inspect or override the model-routing decision |
| `/agentteams` | Manual invocation of Mode B (Claude Code Agent Teams) |

## Total: 26 skills (4 + 5 + 2 + 4 + 3 + 3 + 2 + 3)

Lean, audited for overlap. Cuts vs v1's 43-skill catalog: MiniMax-specific skills dropped entirely; /webresearch merged into /deepresearch; /autoplan into the multispec engine; /qa into /verify; /digestaste + /digestflow are internal runtime functions; /tastebootstrap replaced by auto-bootstrap /taste; product-specific skills (/defineicp /icpweek /claudeproduct etc.) deferred.

## Install

```bash
cmax init                          # writes .claude/skills/* + hooks + dark-patterns
cmax init --target /path/to/proj   # explicit target
cmax init --force                  # overwrite existing
```
