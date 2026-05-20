# The spec → goal → verify pipeline

Claude Code 2.1.139 (May 12, 2026) shipped `/goal` — autonomous multi-turn work against a completion condition. claudemax wraps this with two gates that make it production-safe for power users.

## The gates

```
user goal ──► [SPEC gate] ──► SPEC.md ──► [GOAL loop] ──► artifacts ──► [VERIFY gate] ──► verdict
```

1. **SPEC gate** — Opus writes a contract. No autonomy starts without measurable completion conditions, each with a verifyHint.
2. **GOAL loop** — Opus driver works across N turns. Stops when conditions are met or a real blocker surfaces. Operates within scope (non-goals are honored).
3. **VERIFY gate** — independent blind Opus session re-checks every condition by reading the repo, running tests, grepping. Source of truth for success.

## Why all three

- SPEC alone → you have a contract but no execution.
- GOAL alone → you have a credit card on fire; an unsupervised model claims success on what it didn't do.
- VERIFY alone → you can only check work that exists; you haven't planned it.

Together they form the loop: contract → autonomy → audit.

## SPEC quality is the bottleneck

A bad SPEC produces a bad GOAL run that VERIFY correctly fails. You re-do all three. The cost asymmetry strongly favors spending 30 seconds on a tighter SPEC.

A good completion condition:

- **Measurable** — a blind reviewer can confirm it
- **Specific** — names a file, a test, a command, a behavior
- **Bounded** — doesn't drift; doesn't have "etc"
- **Independent** — doesn't depend on a sibling condition being interpreted a certain way

Anti-pattern: `"the code is clean"`. There's no verifyHint that would let a verifier confirm or deny this.

Better: `"all tests in src/auth/__tests__ pass via 'pnpm test --filter auth'; no eslint errors via 'pnpm lint packages/auth'"`.

## When the verifier returns partial or failed

- **Partial** — iterate `/goal` with the failing conditions as the focused next step. Re-verify.
- **Failed** — if iterating twice doesn't move it, the SPEC is probably wrong. Re-spec, don't re-grind.
- **Verified** — done. Memory records the run.

## When to skip /goal entirely

- Trivial single-edit changes — just edit.
- Highly parallelizable independent packets — `/dispatch` is the right tool; `/goal` would serialize them.
- Exploration without a goal — you don't have a SPEC yet; talk it through interactively first.

## Cost shape

- SPEC: Opus, ~5–15K tokens, dollars.
- GOAL: Opus, 20–200+ turns. Token volume scales with the problem. Budget accordingly. Cap with `--max-turns`.
- VERIFY: Opus, 10–40 turns. Read-heavy, cheap relative to GOAL.

The VERIFY cost is almost always worth it. Skipping it to save 10% of the run cost while gambling 100% of the goal's value is bad math.

## Programmatic use

```typescript
import { writeSpec, runGoal, verify } from "@claudemax/runtime";
import { renderSpecMarkdown } from "@claudemax/core";
import { writeFileSync } from "node:fs";

const spec = await writeSpec("Migrate auth from sessions to passkeys with passing tests");
writeFileSync("SPEC.md", renderSpecMarkdown(spec));

const result = await runGoal(spec, { maxTurns: 150 });
if (result.status !== "finished") {
  console.error("blocked or capped:", result.summary);
  process.exit(1);
}

const report = await verify(spec);
console.log(report.verdict);
```
