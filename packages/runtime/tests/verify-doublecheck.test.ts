import { describe, expect, it } from "vitest";
import type { Spec, VerificationReport } from "@claudemax/core";
import { applyDoubleCheck } from "../src/verify.js";

function spec(): Spec {
  return {
    title: "t",
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: [{ id: "cc-1", description: "d", verifyHint: "ls" }],
    assumptions: [],
    evidenceRequired: [],
    createdAt: new Date().toISOString(),
  };
}

function report(verdict: "verified" | "partial" | "failed"): VerificationReport {
  return {
    spec: spec(),
    perCondition: [
      {
        id: "cc-1",
        met: verdict === "verified",
        evidence: "x",
        confidence: 0.95,
      },
    ],
    suppressedLowConfidence: [],
    verdict,
    verifierTier: "opus",
    notes: "",
    confidenceThreshold: 0.8,
  };
}

describe("applyDoubleCheck (verify.ts doubleCheck combiner)", () => {
  it("default-off: no haiku result → returns Opus report unchanged (byte-identical)", () => {
    const opus = report("verified");
    const out = applyDoubleCheck(opus, undefined);
    expect(out).toBe(opus);
    expect(out.verdict).toBe("verified");
    expect(out.reason).toBeUndefined();
  });

  it("doubleCheck agreement: same verdict from haiku → returns Opus report unchanged", () => {
    const opus = report("verified");
    const out = applyDoubleCheck(opus, { verdict: "verified", reason: "agree" });
    expect(out).toBe(opus);
    expect(out.verdict).toBe("verified");
    expect(out.reason).toBeUndefined();
  });

  it("doubleCheck agreement on 'failed': also passes through", () => {
    const opus = report("failed");
    const out = applyDoubleCheck(opus, { verdict: "failed" });
    expect(out.verdict).toBe("failed");
    expect(out.reason).toBeUndefined();
  });

  it("doubleCheck disagreement: surfaces 'unverified' with reason listing both verdicts; does NOT flip Opus per-condition findings", () => {
    const opus = report("verified");
    const out = applyDoubleCheck(opus, {
      verdict: "failed",
      reason: "evidence does not match the claim",
    });
    expect(out.verdict).toBe("unverified");
    expect(out.reason).toBeDefined();
    expect(out.reason).toContain("opus=verified");
    expect(out.reason).toContain("haiku=failed");
    expect(out.perCondition).toEqual(opus.perCondition);
    expect(out.perCondition[0]?.met).toBe(true);
  });

  it("doubleCheck disagreement when opus=partial vs haiku=verified: still 'unverified'", () => {
    const opus = report("partial");
    const out = applyDoubleCheck(opus, { verdict: "verified" });
    expect(out.verdict).toBe("unverified");
    expect(out.reason).toContain("opus=partial");
    expect(out.reason).toContain("haiku=verified");
  });
});
