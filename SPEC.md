# Build P1 (memory-first retrieval) + P2 (structural citation-claim linkage) deepresearch improvements in claudemax. Lean, Anthropic-only, SOTA-2026-inspired but DNA-native.

> Created: 2026-05-23T20:06:19.477Z

## Goal
Build P1 (memory-first retrieval) + P2 (structural citation-claim linkage) deepresearch improvements in claudemax. Lean, Anthropic-only, SOTA-2026-inspired but DNA-native.

## Completion conditions
1. **rc-typecheck** — Workspace typecheck stays green across all packages after the type + runtime + caller changes
   - Verify: pnpm typecheck exits 0
2. **rc-build** — Workspace build succeeds across all packages
   - Verify: pnpm -r build exits 0
3. **rc-runtime-tests** — Runtime tests (existing 185 + new memory-first tests) all pass
   - Verify: pnpm --filter @claudemax/runtime test exits 0
4. **rc-memory-tests** — Memory package tests pass (existing + any new query-method coverage)
   - Verify: pnpm --filter @claudemax/memory test exits 0
5. **rc-cli-tests** — CLI package tests pass with the updated print loop
   - Verify: pnpm --filter @claudemax/cli test exits 0
6. **rc-no-new-deps** — No new runtime dependencies were added; Anthropic-only rule preserved
   - Verify: git diff -- '**/package.json' '**/pnpm-lock.yaml' — dependency lists are unchanged (only intra-workspace edits if any)
7. **rc-anthropic-sdk-only** — No reintroduction of bare @anthropic-ai/sdk; only @anthropic-ai/claude-agent-sdk is used
   - Verify: rg -n "from '@anthropic-ai/sdk'" packages/ — returns nothing
8. **rc-end-to-end-shape** — A live or mocked run of deepresearch returns a ResearchBrief whose keyFindings each have ≥1 sourceUrl, and whose prompt was seeded with prior research when matching ledger rows exist
   - Verify: Inspect the new packages/runtime/tests/deepresearch-memory-first.test.ts assertions — they cover both shape and seeding end-to-end against a mocked query()

## Non-goals
- (none)

## Constraints
- (none)

## Assumptions
- (none)

## Evidence required
- (none)
