import { describe, it, expect } from "vitest";
import {
  decideNext,
  consecutiveNoProgress,
  passMadeProgress,
  hasRepeatedFingerprint,
  hashString,
  workItemKey,
  type LoopPass,
  type LoopBudget,
} from "./loop.js";

function pass(p: Partial<LoopPass> & { index: number }): LoopPass {
  return {
    verdict: "partial",
    passedConditions: 0,
    totalConditions: 3,
    blocked: false,
    creditUsd: 1,
    ...p,
  };
}

const roomyBudget: LoopBudget = {
  maxPasses: 100,
  maxCreditUsd: 1000,
  spentCreditUsd: 0,
  passCount: 1,
};

describe("decideNext — terminal verdicts", () => {
  it("returns done when the latest pass is verified", () => {
    const d = decideNext({
      history: [pass({ index: 1, verdict: "verified", passedConditions: 3 })],
      budget: roomyBudget,
    });
    expect(d.action).toBe("done");
  });

  it("returns blocked when the advance reported a hard blocker", () => {
    const d = decideNext({
      history: [pass({ index: 1, blocked: true })],
      budget: roomyBudget,
    });
    expect(d.action).toBe("blocked");
  });

  it("verified beats blocked when both are set (success wins)", () => {
    const d = decideNext({
      history: [pass({ index: 1, verdict: "verified", passedConditions: 3, blocked: true })],
      budget: roomyBudget,
    });
    expect(d.action).toBe("done");
  });

  it("verified beats an exhausted budget (success at the edge still wins)", () => {
    const d = decideNext({
      history: [pass({ index: 1, verdict: "verified", passedConditions: 3 })],
      budget: { maxPasses: 1, maxCreditUsd: 5, spentCreditUsd: 9, passCount: 1 },
    });
    expect(d.action).toBe("done");
  });
});

describe("decideNext — ceilings", () => {
  it("stops on credit ceiling before stall logic", () => {
    const d = decideNext({
      history: [pass({ index: 1 }), pass({ index: 2 }), pass({ index: 3 })],
      budget: { maxPasses: 100, maxCreditUsd: 10, spentCreditUsd: 10, passCount: 3 },
    });
    expect(d.action).toBe("stop-budget");
  });

  it("stops on pass ceiling", () => {
    const d = decideNext({
      history: [pass({ index: 1, passedConditions: 1 })],
      budget: { maxPasses: 1, maxCreditUsd: 1000, spentCreditUsd: 1, passCount: 1 },
    });
    expect(d.action).toBe("stop-max");
  });

  it("a hard blocker beats a budget stop (surface the actionable blocker)", () => {
    const d = decideNext({
      history: [pass({ index: 1, blocked: true })],
      budget: { maxPasses: 1, maxCreditUsd: 1, spentCreditUsd: 99, passCount: 9 },
    });
    expect(d.action).toBe("blocked");
  });
});

describe("decideNext — stall → respec → stop-stuck", () => {
  it("continues while progress is being made", () => {
    const d = decideNext({
      history: [
        pass({ index: 1, passedConditions: 1 }),
        pass({ index: 2, passedConditions: 2 }),
      ],
      budget: roomyBudget,
    });
    expect(d.action).toBe("iterate");
  });

  it("respecs after two consecutive no-progress passes", () => {
    const d = decideNext({
      history: [
        pass({ index: 1, passedConditions: 2 }),
        pass({ index: 2, passedConditions: 2 }),
        pass({ index: 3, passedConditions: 2 }),
      ],
      budget: roomyBudget,
      respecCount: 0,
    });
    expect(d.action).toBe("respec");
  });

  it("stops-stuck when respecs are exhausted", () => {
    const d = decideNext({
      history: [
        pass({ index: 1, passedConditions: 2 }),
        pass({ index: 2, passedConditions: 2 }),
        pass({ index: 3, passedConditions: 2 }),
      ],
      budget: roomyBudget,
      respecCount: 2,
      maxRespecs: 2,
    });
    expect(d.action).toBe("stop-stuck");
  });

  it("a single no-progress pass below threshold keeps iterating", () => {
    const d = decideNext({
      history: [
        pass({ index: 1, passedConditions: 2 }),
        pass({ index: 2, passedConditions: 2 }),
      ],
      budget: roomyBudget,
    });
    expect(d.action).toBe("iterate");
  });

  it("respec threshold is configurable (threshold 1 respecs on a single stall)", () => {
    // First pass (0→2) is progress; the second clears nothing new → one no-progress
    // pass. At the default threshold (2) that would keep iterating; at threshold 1
    // it respecs. This is the configurability the option exists for.
    const history = [
      pass({ index: 1, passedConditions: 2 }),
      pass({ index: 2, passedConditions: 2 }),
    ];
    expect(decideNext({ history, budget: roomyBudget }).action).toBe("iterate");
    expect(decideNext({ history, budget: roomyBudget, respecAfterStuck: 1 }).action).toBe("respec");
  });

  it("empty history begins iterating", () => {
    expect(decideNext({ history: [], budget: roomyBudget }).action).toBe("iterate");
  });
});

describe("consecutiveNoProgress / passMadeProgress", () => {
  it("counts the tail run that never beats the high-water mark", () => {
    const h = [
      pass({ index: 1, passedConditions: 1 }),
      pass({ index: 2, passedConditions: 3 }),
      pass({ index: 3, passedConditions: 2 }),
      pass({ index: 4, passedConditions: 3 }),
    ];
    expect(consecutiveNoProgress(h)).toBe(2);
    expect(passMadeProgress(h)).toBe(false);
  });

  it("a regression then recovery to a new high resets the counter", () => {
    const h = [
      pass({ index: 1, passedConditions: 2 }),
      pass({ index: 2, passedConditions: 1 }),
      pass({ index: 3, passedConditions: 4 }),
    ];
    expect(consecutiveNoProgress(h)).toBe(0);
    expect(passMadeProgress(h)).toBe(true);
  });
});

describe("fingerprint + dedup helpers", () => {
  it("flags a repeated fingerprint inside the window", () => {
    const h = [
      pass({ index: 1, fingerprint: "a" }),
      pass({ index: 2, fingerprint: "b" }),
      pass({ index: 3, fingerprint: "b" }),
    ];
    expect(hasRepeatedFingerprint(h, 3)).toBe(true);
  });

  it("distinct fingerprints in the window are not flagged", () => {
    const h = [
      pass({ index: 1, fingerprint: "a" }),
      pass({ index: 2, fingerprint: "b" }),
      pass({ index: 3, fingerprint: "c" }),
    ];
    expect(hasRepeatedFingerprint(h, 3)).toBe(false);
  });

  it("hashString is deterministic and stable", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
    expect(hashString("hello")).not.toBe(hashString("world"));
  });

  it("workItemKey does not collide on boundary shifts", () => {
    expect(workItemKey("ab", "c")).not.toBe(workItemKey("a", "bc"));
  });
});
