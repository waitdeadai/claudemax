# Behavior-gated simplify pass — audit verdict + spec

Status: **shipped** (2026-06-09). Decision record for integrating the "simplify"
concern from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
into claudemax. Methodology: the harness's own audit-before-integrate rule
(`/cc-audit`, lean-catalog discipline).

## The ask

Evaluate integrating `addyosmani/agent-skills` — specifically its
`code-simplification` skill — into claudemax, "into the cmax workflow."

## Audit (evidence)

- `addyosmani/agent-skills` is 23 model-agnostic **process** skills (markdown
  prompts, no code). The relevant one is `skills/code-simplification/SKILL.md`.
- Its own frontmatter states it is *"Inspired by the Claude Code Simplifier
  plugin … adapted as a model-agnostic, process-driven skill."* It is a
  **derivative of the Anthropic-official `code-simplifier` agent**, which is
  already installed on this machine at
  `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-simplifier/`.
- This harness **already exposes a native `/simplify` skill** ("review changed
  code for reuse, simplification, efficiency, altitude cleanups, then apply").
- Overlap is therefore high: behavior-preservation, clarity-over-cleverness,
  scope-to-recent, no-nested-ternaries are all covered by native `/simplify` +
  the marketplace `code-simplifier` agent; finding smells in existing code is
  `/audit`; reviewing a diff is `/review` + native `/code-review`.

**Verdict: WRAP, not add-a-skill.** Adding a 32nd catalog skill would violate the
lean-catalog rule (`feedback_skill_catalog`) and duplicate the native `/simplify`.
The genuinely-additive ~30% is *judgment discipline* claudemax had no pipeline
surface for:

1. **Chesterton's Fence** — recover original intent (incl. `git blame`) before
   removing anything.
2. **Rule of 500** — refactors touching >500 lines use codemods, not hand-edits.
3. **"Tests modified to stay green = behavior changed"** — a verifier-grade
   invariant (the mutation-testing principle).
4. **Refactor-separate-from-feature** commit discipline.

## SOTA-2026 grounding (why a gated pipeline pass, deepresearch-backed 2026-06-09)

- A post-generation refine pass is the dominant agentic-coding pattern, but gains
  are front-loaded: *"two repair rounds capture 76–95% of achievable gains"*
  ([arXiv 2604.10508](https://arxiv.org/html/2604.10508)). → **bounded to ≤2
  rounds, opt-in**, not an open loop.
- Behavior preservation is verified via the test suite as a characterization /
  mutation oracle ([Springer 2026](https://link.springer.com/chapter/10.1007/978-3-031-94544-1_12),
  [Meta @ FSE 2025](https://dl.acm.org/doi/10.1145/3696630.3728544),
  [arXiv 2603.23443](https://arxiv.org/html/2603.23443v1)). claudemax already
  encodes this in `mutation-verify.ts`; the simplify gate reuses the discipline.

## What shipped

`packages/runtime/src/simplify.ts` — `runSimplifyPass()`:

- Runs **post-build, pre-verify** in the `cmax run` pipeline (solo mode only;
  Mode B teammates work in isolated worktrees).
- **Opt-in:** `--simplify`; auto-on for `--variant opusolo` (escape:
  `CMAX_NO_SIMPLIFY=1`).
- **Bounded** to `maxRounds` (default 2).
- **Behavior-preservation gate** (`evaluatePreservationGate`, a pure, unit-tested
  function): a round is ACCEPTED only if the pre-existing suite stays green AND
  no test file was touched; otherwise the round is **reverted** via a `git`
  snapshot (`git stash create` → `git checkout <snap> -- .`). No green baseline →
  the pass **skips** (honest: no oracle, no claim).
- The agent prompt carries the Chesterton's-Fence / Rule-of-500 / clarity /
  scope discipline, credited to the native plugin + addyosmani upstream.

Catalog impact: **none** — no new skill. Discipline folded into the pipeline +
`/review` (`skills/review/SKILL.md`).

## Completion conditions

| id | condition | verifyHint |
|----|-----------|------------|
| sp1 | `runSimplifyPass` exists and is exported from runtime | `grep runSimplifyPass packages/runtime/src/index.ts` |
| sp2 | Behavior gate reverts on test-touch even when green | `vitest run src/simplify.test.ts` — "reverts a round that modifies a test file" passes |
| sp3 | Pass is wired post-build/pre-verify, opt-in + opusolo-default | `grep -n "simplify pass" packages/cli/src/commands/run.ts` |
| sp4 | No new catalog skill added (lean catalog intact) | `ls skills/ \| wc -l` unchanged; no `skills/simplify/` |
| sp5 | Build + typecheck + full test suite green | `pnpm build && pnpm typecheck && pnpm test` |

## Non-goals

- Not a bug-hunter (that is `/review` / `/audit`).
- Not run in Mode B / Agent Teams (worktree isolation; the lead cwd diff would be
  incomplete).
- Does not infer per-run custom test commands beyond the suite default; a red or
  absent baseline safely skips rather than guessing.
