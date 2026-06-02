// Long-run reliability (§5): anti-prompt-decay.
//
// In long autonomous runs the agent gradually loses the initial directive and
// reverts to generic, less-careful behavior. Defenses (helpers — the goal driver
// re-reads the SPEC; these make re-anchoring concrete and add a deterministic
// reasoning-health checkpoint):
//   - buildReinjectionBlock(): a compact restatement of the spec + invariants to
//     re-feed periodically, so the contract lives in a durable block, not just in
//     a context window that rotates.
//   - poisonPill(): a known-answer checkpoint to detect a drifted/looping run.

import type { Spec } from "@claudemax/core";

export function shouldReinject(turn: number, everyN = 25): boolean {
  return turn > 0 && everyN > 0 && turn % everyN === 0;
}

export function buildReinjectionBlock(spec: Spec, invariants: readonly string[] = []): string {
  const cc = spec.completionConditions
    .map((c) => `- [${c.id}] ${c.description} (verify: ${c.verifyHint})`)
    .join("\n");
  const inv = invariants.length
    ? `\nINVARIANTS (still hold):\n${invariants.map((i) => `- ${i}`).join("\n")}`
    : "";
  return `SPEC RE-ANCHOR (you may have drifted in this long run — this is the contract, re-read it):
GOAL: ${spec.goal}
COMPLETION CONDITIONS (every one must be met WITH evidence):
${cc}${inv}
Do not declare done until every condition would pass a blind, evidence-required verify.`;
}

// Deterministic checkpoint ("poison pill"): a known-answer probe that a healthy
// reasoning loop answers trivially and a drifted/looping one fails. Pure + offline
// (no Date.now / Math.random — seed-driven so it is reproducible).
export interface PoisonPill {
  readonly prompt: string;
  readonly expected: string;
}

export function poisonPill(seed = 7): PoisonPill {
  const a = (Math.abs(Math.trunc(seed)) % 9) + 1;
  const b = ((Math.abs(Math.trunc(seed)) * 3) % 9) + 1;
  return { prompt: `Checkpoint — reply with ONLY the number: what is ${a} + ${b}?`, expected: String(a + b) };
}

export function checkPoisonPill(pill: PoisonPill, answer: string): boolean {
  // Accept the expected number as a standalone token (avoid matching "12" in "120").
  return new RegExp(`(^|[^0-9])${pill.expected}([^0-9]|$)`).test(answer.trim());
}
