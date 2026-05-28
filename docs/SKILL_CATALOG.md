# Skill catalog — lean 31 active

Audited for overlap. Every skill has a distinct, non-overlapping purpose. Compare to v1's 43-skill catalog: 17 cut, 3 added (`/agentteams`, `/tdd`, `/harness-audit`). Trimmed 2026-05-28: the `/workflow` + `/opussonnet` ALIAS-for-/cmax entries (`/workflow` collided with Claude Code's native **Workflow tool**) and the deprecated `/dispatch` stub. The `opussonnet`/`opusolo` model-routing **variants** remain in the CLI (`cmax run --variant`), independent of any skill.

## Umbrellas (3) — daily-drivers; each auto-runs the full pipeline

| Skill | Plan/judge | Sub-Spec /goal exec | Verify | Use |
|---|---|---|---|---|
| `/ask` | Opus | Sonnet | Opus | Canonical user-facing entry (same engine as `/cmax`) |
| `/cmax` | Opus | Sonnet | Opus | Brand umbrella; daily-driver default |
| `/opusolo` | Opus | **Opus** | Opus | Max effectiveness; auth/payments/novel-domain |

## Research (5)

| Skill | Purpose | Distinct from |
|---|---|---|
| `/deepresearch` | Sourced web-current research with ledger | /audit (web vs code) |
| `/audit` | Adversarial code-quality scan of existing code | /review (existing vs proposed diff) |
| `/investigate` | Multi-source bug root-cause (depth-first) | /audit (depth vs breadth) |
| `/codesearch` | Multi-pattern search with relevance ranking | /audit (locate vs assess) |
| `/introspect` | Confidence/assumption gate; blocks /goal at < 6 | /audit (plan vs code) |

## Planning (2)

| Skill | Purpose | Distinct from |
|---|---|---|
| `/spec` | Single SPEC.md with measurable completion conditions | Multispec engine (which does N specs auto) |
| `/specqa` | Spec quality gate; mechanically-checkable verifyHints | /introspect (spec vs plan confidence) |

## Execution (4)

| Skill | Purpose | Distinct from |
|---|---|---|
| `/goal` | Autonomous /goal loop (wraps Claude Code native /goal) | Multispec (single objective vs N) |
| `/parallel` | Distinct-packet fan-out (different things) | /hive (different vs same problem) |
| `/hive` | Same problem N times → merge | /parallel + /council (no roles) |
| `/council` | 3-Opus adversarial debate (proposer/critic/judge) | /hive (with roles) |

## Verification (3)

| Skill | Purpose | Distinct from |
|---|---|---|
| `/verify` | Blind Opus pass against SPEC completion conditions | /review (spec vs diff) |
| `/review` | Diff review (correctness, security, style) | /audit (proposed vs existing) |
| `/ship` | Final go/no-go combining /verify + /review | /verify (one input vs combined) |

## Memory & state (3)

| Skill | Purpose |
|---|---|
| `/memory` | Search/inspect persistent SQLite+FTS5 store |
| `/align` | One-shot semantic decision recorder → memory.decisions |
| `/overnight` | Long-running mode with file checkpointing + session resumption |

## Taste (2) — auto-bootstrap, NOT question-driven

| Skill | Purpose |
|---|---|
| `/taste` | Auto-bootstrap via /deepresearch (NO 10 questions) |
| `/deepretaste` | Drift detection vs current code |

## Infrastructure (5)

| Skill | Purpose | Distinct from |
|---|---|---|
| `/agentfactory` | Governed AgentDefinition creation + Hermes-style registry | /agentteams (creation vs invocation) |
| `/route` | Inspect or override the model-routing decision | runtime router (override vs default) |
| `/agentteams` | Manual invocation of Mode B (Claude Code Agent Teams) | /cmax (manual vs auto-selected) |
| `/harness-audit` | Periodic review of claudemax's own scaffolding | /cc-audit (claudemax vs upstream CC) |
| `/cc-audit` | SOTA-2026 deepresearch-backed audit of new Claude Code CLI releases; verdict per change (IGNORE/WRAP/INTEGRATE/DEFER) | /harness-audit (upstream vs claudemax) |

## Cuts vs v1 with rationale

| Cut v1 skill | Reason |
|---|---|
| /opusminimax /sonnetminimax | MiniMax-specific; v2 is Anthropic-only |
| /opusworkflow (separate) | Identical to /opussonnet in v2 once MiniMax → Sonnet |
| /sonnetonly | Not in usage pattern; ad-hoc via `--variant` flag if needed |
| /hiveworkflow | Overlaps /opussonnet + /hive |
| /webresearch | Merged into /deepresearch (uses web by default) |
| /autoplan | Merged into multispec engine |
| /qa | Merged into /verify (verifyHints can name tests) |
| /digestaste /digestflow | Internal runtime functions for hooks, not user-facing |
| /tastebootstrap | Replaced by /taste auto-bootstrap |
| /agent-view /remote-control /goal-mode | Native Claude Code features; document, don't reimplement |
| /sprint /defineicp /icpweek /claudeproduct /metacognition /leveragepath /browse /demo /visualize /visualizeworkflow | Product/marketing/visualization — not core to daily SW work |

## Adding new skills — overlap audit checklist

Before adding a new skill:

1. **Distinct purpose** — does any existing skill cover this? If yes, extend it.
2. **Earns daily use** — is this a thing you'd invoke at least monthly?
3. **Non-overlapping with umbrellas** — is this something /cmax should auto-run, or something the user invokes alone? If auto, it's a runtime function; if alone, it's a skill.
4. **Distinct from CLI commands** — does this need to be a slash command in Claude Code, or just a `cmax X` CLI command?

If you add a skill, justify in this doc with a one-line "Distinct from" entry.
