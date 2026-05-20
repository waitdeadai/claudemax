# /taste — auto-bootstrap

Replaces v1's `/tastebootstrap` 10-question wizard. v2 auto-derives `taste.md` + `taste.vision` from repo evidence + current-time SOTA research with **zero questions** in the common case.

## Mechanism

`packages/runtime/src/taste.ts` + `skills/taste/SKILL.md` + `cmax taste init`:

1. **Read repo signals**:
   - README.md (if present, first 4KB)
   - package manifest (package.json, Cargo.toml, pyproject.toml, go.mod)
   - top-level directory entries
   - framework detection (Next, React, FastAPI, Fastify, Hono, NestJS, etc.)

2. **Build research topic** from signals + current month:
   - "SOTA architecture and best practices for `<framework>` as of `<YYYY-MM>`"
   - or "SOTA architecture and best practices as of `<YYYY-MM>` for the project described in this README excerpt:\n\n`<excerpt>`"

3. **/deepresearch** that topic. WebSearch + WebFetch in parallel; source ledger persisted to `memory.research_sources`.

4. **Synthesize** (Opus) → JSON object `{ tasteMd, tasteVision }` with `outputFormat: json_schema`. No prose, no markdown fences.

5. **Write** `taste.md` + `taste.vision` to repo root.

6. **One fallback question** only if the repo has no signal (empty dir, no README, no package manifest). Exact question: `"What are you building, in one sentence?"`

## Why auto-bootstrap

- 10 questions is friction. The model has more signal from the repo + web than the user would type.
- Anchored on current-time SOTA, not training-cutoff opinions.
- Re-runnable cheaply (`/deepretaste` runs the same engine to detect drift).

## What goes in taste.md vs taste.vision

| File | Content |
|---|---|
| `taste.md` | Declarative rules. Operating principles. Code style. Architecture invariants. Deps posture. Test posture. Short, opinionated, no fluff. |
| `taste.vision` | Narrative north star. ICP. Success criteria. One short paragraph each. |

## How the harness uses taste

- **SessionStart hook** (`.claude/hooks/cmax-session-start.sh`) reads taste.md and taste.vision and injects them as additional context into every workflow's system prompt.
- **/introspect** cross-references plans against taste.md; flags deviations as assumptions to surface.
- **/audit** and **/review** flag taste violations in existing code and proposed diffs.
- **/deepretaste** re-runs the bootstrap and reports drift between recorded taste and current state.

## CLI

```bash
cmax taste init                # auto-bootstrap; writes taste.md + taste.vision
cmax taste init --regenerate   # ignore existing; re-derive from scratch
```

## Example output shape

```markdown
# taste.md (excerpt)

## Operating principles
- Anthropic-only by design (no multi-provider abstraction).
- Spec-driven autonomy: no /goal handoff without a SPEC and a passing /specqa.
- Effectiveness is the ceiling; cost-guard only protects the monthly Max credit envelope.

## Code style
- TypeScript strict, ES modules, NodeNext.
- No default exports except binary entry points.
- Prefer `readonly` and pure types in `packages/core`.

## Architecture invariants
- Subscription auth path (Agent SDK credit) by default; API key opt-out.
- /verify, /spec, /architect always run on Opus — never demoted.
- Multispec is the default decomposition; single-spec is an internal optimization.
```

```markdown
# taste.vision (excerpt)

## North star
Effective completion of software work, no matter how big the task is. The flagship pipeline is deepresearch → multispec → parallel /goal → verify. Power users on Claude Max should be able to ship in hours what previously took days.

## ICP
Power users of Claude Code on Max 5x ($100) or Max 20x ($200) subscriptions. They want max effectiveness and route models appropriately — Opus for judgment, Sonnet for execution, Haiku for throughput. They optimize cost but never at the expense of /verify quality.

## Success criteria
- /cmax run "..." on a 50-file migration completes with rollup /verify = verified in < 4 hours wall clock on a 6-core machine.
- Multispec engine auto-selects Mode B for swarm work; Agent View dashboard surfaces live state without user babysitting.
- Dark-patterns hooks catch ≥ 95% of LLM dark patterns (vibes, fake stats, aggregator hallucination, etc.) before they reach the user.
```

## Re-running and drift detection

`/deepretaste` is the same engine; its job is to surface what's changed.

```bash
cmax taste init --regenerate   # full re-derive (overwrites)
# or invoke /deepretaste skill in Claude Code:
#   "Run /deepretaste against current taste"
# → prints drift report; --apply patches taste.md in place
```
