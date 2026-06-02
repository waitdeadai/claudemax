import { describe, expect, it } from "vitest";
import type { Spec } from "@claudemax/core";
import { buildReinjectionBlock, checkPoisonPill, poisonPill, shouldReinject } from "../src/reinject.js";
import { dedupeBy, hierarchicalMerge } from "../src/synthesis.js";

function spec(): Spec {
  return {
    title: "t",
    goal: "ship the thing",
    nonGoals: [],
    constraints: [],
    completionConditions: [{ id: "cc-1", description: "works", verifyHint: "test passes" }],
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("anti-prompt-decay (reinject)", () => {
  it("shouldReinject fires every N turns, never at 0", () => {
    expect(shouldReinject(0, 25)).toBe(false);
    expect(shouldReinject(25, 25)).toBe(true);
    expect(shouldReinject(26, 25)).toBe(false);
    expect(shouldReinject(50, 25)).toBe(true);
  });

  it("buildReinjectionBlock restates the goal, conditions, and invariants", () => {
    const b = buildReinjectionBlock(spec(), ["anthropic-only"]);
    expect(b).toContain("ship the thing");
    expect(b).toContain("cc-1");
    expect(b).toContain("anthropic-only");
  });

  it("poison pill: the correct answer passes, drift fails", () => {
    const p = poisonPill(7);
    expect(checkPoisonPill(p, p.expected)).toBe(true);
    expect(checkPoisonPill(p, "honestly not sure, maybe 999")).toBe(false);
  });
});

describe("map-reduce synthesis (decomposed fan-in)", () => {
  it("dedupeBy keeps the first of each key", () => {
    const out = dedupeBy([{ k: "a", v: 1 }, { k: "a", v: 2 }, { k: "b", v: 3 }], (x) => x.k);
    expect(out.map((x) => x.v)).toEqual([1, 3]);
  });

  it("hierarchicalMerge sums everything and never shows the reducer more than groupSize", async () => {
    let maxSeen = 0;
    const total = await hierarchicalMerge([1, 2, 3, 4, 5, 6, 7], 2, (g) => {
      maxSeen = Math.max(maxSeen, g.length);
      return g.reduce((a, b) => a + b, 0);
    });
    expect(total).toBe(28);
    expect(maxSeen).toBeLessThanOrEqual(2); // no stage ingests all raw input — the anti-stall property
  });

  it("hierarchicalMerge passes a single item through without calling the reducer", async () => {
    let calls = 0;
    const r = await hierarchicalMerge([42], 3, (g) => {
      calls++;
      return g.reduce((a, b) => a + b, 0);
    });
    expect(r).toBe(42);
    expect(calls).toBe(0);
  });
});
