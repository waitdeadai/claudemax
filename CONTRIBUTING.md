# Contributing to claudemax

Power users only. This is a sharp tool for a specific ICP (Claude Max subscribers running CLI-first spec-driven autonomy). Patches that broaden the audience without consensus tend to get pushed back.

## Read first

- [`README.md`](./README.md) — what claudemax is
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — the three layers (skills / runtime / hooks)
- [`docs/SKILL_CATALOG.md`](./docs/SKILL_CATALOG.md) — the lean 29-active-skill catalog with overlap-audit checklist (plus 1 deprecated stub)
- [`CLAUDE.md`](./CLAUDE.md) — repo rules that apply to changes here

## Dev setup

```bash
git clone https://github.com/waitdeadai/claudemax
cd claudemax
pnpm install
pnpm build
pnpm test
bash scripts/smoke.sh
```

Requirements: Node 22+, pnpm 11+, git, curl. Optional: tmux, Tailscale, qrencode (for the remote-operation surface), claude CLI (for Mode B Agent Teams).

## House rules

These are load-bearing. PRs that violate them without discussion will be closed.

1. **Anthropic-only.** No multi-provider abstractions. If a task wants MiniMax / OpenAI / Gemini, push back or fork.
2. **Lean catalog.** 29 active skills + 1 deprecated stub (`/dispatch`), audited for overlap. v0.2.1 added `/tdd` and `/harness-audit` from Anthropic's harness-design guide and Affaan's production patterns. Two umbrellas (`/workflow`, `/opussonnet`) are explicit ALIAS-for-/cmax entries — router should never pick them on merit. Before adding a new skill, check `docs/SKILL_CATALOG.md`'s overlap-audit checklist AND run `/harness-audit` to confirm the existing 29 still earn their place.
3. **Router defaults are sacred.** The baseline tier table + escalation/demotion triggers in `packages/core/src/router.ts` define the harness's identity. Discuss before changing baselines.
4. **`/verify`, `/spec`, `/architect` always run on Opus.** Never demote them, regardless of `--cheap` or monthly credit percentage. They're in `NEVER_DEMOTE`.
5. **Multispec is the default.** Every umbrella auto-runs deepresearch + multispec decompose + parallel /goal + per-sub-spec verify + rollup verify. No `--multi` flag.
6. **/taste is auto-bootstrap, NOT 10 questions.** Replaces v1's /tastebootstrap. PRs that re-add interactive Q&A wizards will be closed.
7. **Two parallelism modes auto-selected per spec shape.** Mode A (SDK subagents in one `query()`) for small/short runs. Mode B (Claude Code Agent Teams) for big swarms. PRs adding a third mode need consensus.
8. **Workers return evidence.** Every packet emits `EVIDENCE:` + `STATUS:` blocks. Dark-patterns hooks (`no-aggregator-hallucination`, `no-silent-worker-success`) enforce this.
9. **No comments explaining what.** Code says what. Comments only for non-obvious why. Multi-paragraph docstrings get cut in review.
10. **Plan-aware cost-guard thresholds.** 70 / 90 / 95% are the canonical guard / danger / blocked boundaries. Don't shift them per-tier — Max 5x and Max 20x are first-class equals.
11. **No `as any`.** Use `as never` if the SDK types are stale on documented options (`outputFormat`, `effort`, `skills`, etc.).

## TypeScript style

- ES modules, NodeNext, strict mode.
- `noUncheckedIndexedAccess: true` — handle `T | undefined` from array/record access.
- `readonly` arrays + types in `packages/core`.
- No default exports except binary entry points.
- One concept per file. Avoid mega-files.

## Tests

Every PR must keep:

- `pnpm test` green (currently 72 unit tests)
- `bash scripts/smoke.sh` green (currently 67 CLI smoke checks)

New CLI commands need a `--help` exit-0 check in `scripts/smoke.sh`.
New runtime functions that don't require live API need unit tests with mocked I/O.
Live-API paths (`query()` calls) can't be unit-tested directly — exercise them manually via the corresponding CLI command and note in the PR description.

## PR workflow

1. Fork + branch off `main`.
2. Make changes; keep PRs scoped (don't bundle a skill addition with a router refactor).
3. `pnpm build && pnpm test && bash scripts/smoke.sh` all green locally.
4. If your change touches the SDK option surface (`packages/runtime/src/*.ts`), check `code.claude.com/docs/en/agent-sdk/typescript` for the current shape and update `as never` casts only when truly needed.
5. Open PR with: what changed, why (link to issue or rationale), how you tested, any new dependencies or env vars.
6. Update `CHANGELOG.md` under `## [Unreleased]` (create the section if it doesn't exist).
7. Update relevant docs in `docs/` — especially `SKILL_CATALOG.md` if you add a skill.

## Adding a skill (special rules)

1. Confirm no existing skill covers your use case (overlap audit in `docs/SKILL_CATALOG.md`).
2. Add `skills/<name>/SKILL.md` with proper frontmatter (`name`, `description`).
3. Add the skill to `skills/README.md` catalog + `docs/SKILL_CATALOG.md` with a "Distinct from" entry.
4. Add a `--help` exit-0 check in `scripts/smoke.sh` if the skill has a corresponding CLI command.
5. PR description must justify why this earns a slot in the daily-driver catalog.

## Adding a CLI command

1. New file in `packages/cli/src/commands/<name>.ts` exporting a `Command` builder.
2. Register in `packages/cli/src/index.ts`.
3. Add `--help` smoke check.
4. Add at least one unit test if the command has non-trivial pure logic.
5. Document in `README.md`'s CLI table.

## Release process (maintainer-only)

1. Bump versions in all `packages/*/package.json` to match (single coordinated version).
2. Update `CHANGELOG.md` under a new `## [X.Y.Z] — YYYY-MM-DD` section.
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. GitHub release with CHANGELOG section as body.
5. If publishing to npm: `pnpm -r publish --access public` (requires npm org + auth).

## Code of conduct

Be technically rigorous. Disagree with reasoning, not vibes. Don't waste reviewers' time with PRs that ignore the house rules above.
