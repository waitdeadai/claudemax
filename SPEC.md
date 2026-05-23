# Add a SOTA-2026 Haiku-judge cascade to claudemax (Tranquera-inspired tiered validation with BLOCK/REDACT/WARN/LOG actions) — strictly additive, opt-in, fail-closed to existing regex/agentcloseout-physics verdicts, gated by 70% budgetTag cost-guard.

> Created: 2026-05-23T19:25:51.858Z

## Goal
Add a SOTA-2026 Haiku-judge cascade to claudemax (Tranquera-inspired tiered validation with BLOCK/REDACT/WARN/LOG actions) — strictly additive, opt-in, fail-closed to existing regex/agentcloseout-physics verdicts, gated by 70% budgetTag cost-guard.

## Completion conditions
1. **rollup-typecheck** — pnpm typecheck exits 0 across the monorepo with all new modules integrated
   - Verify: pnpm typecheck
2. **rollup-runtime-tests** — Full runtime test suite passes including haiku-judge and verify doubleCheck coverage
   - Verify: pnpm --filter @claudemax/runtime test
3. **rollup-cli-tests** — Full CLI test suite passes with the new verdict-judge command
   - Verify: pnpm --filter @claudemax/cli test
4. **rollup-doc-length** — docs/HAIKU_JUDGE.md exists with at least 120 lines
   - Verify: test -f docs/HAIKU_JUDGE.md && test "$(wc -l < docs/HAIKU_JUDGE.md)" -ge 120
5. **rollup-deliverables-present** — All seven named deliverables exist on disk
   - Verify: test -f skills/dark-patterns/lib/haiku-judge.sh && test -f packages/cli/src/commands/verdict-judge.ts && test -f packages/runtime/src/haiku-judge.ts && test -f packages/runtime/src/haiku-judge.test.ts && test -f packages/runtime/src/verify.ts && test -f docs/HAIKU_JUDGE.md
6. **rollup-one-poc-hook** — Exactly one POC hook (no-vibes OR no-emoji-spam) opts in to the haiku-judge library; no others touched
   - Verify: [ "$(grep -lE 'haiku-judge\.sh|haiku_judge_escalate' skills/dark-patterns/hooks/no-vibes.sh skills/dark-patterns/hooks/no-emoji-spam.sh 2>/dev/null | wc -l)" = "1" ] && [ "$(ls skills/dark-patterns/hooks/*.sh | grep -v -E '(no-vibes|no-emoji-spam)\.sh$' | xargs grep -l haiku 2>/dev/null | wc -l)" = "0" ]
7. **rollup-no-api-key-sdk** — @anthropic-ai/sdk (API-key SDK) is NOT introduced anywhere in the new code paths
   - Verify: ! grep -rE "from ['\"]@anthropic-ai/sdk['\"]|require\(['\"]@anthropic-ai/sdk['\"]" packages/runtime/src/haiku-judge.ts packages/cli/src/commands/verdict-judge.ts

## Non-goals
- (none)

## Constraints
- (none)

## Assumptions
- (none)

## Evidence required
- (none)
