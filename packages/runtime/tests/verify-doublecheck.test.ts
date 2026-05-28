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

  it("doubleCheck disagreement: WARN-only — Opus verdict STANDS, a non-authoritative warning is appended to notes (never overrides)", () => {
    const opus = report("verified");
    const out = applyDoubleCheck(opus, {
      verdict: "failed",
      reason: "evidence does not match the claim",
    });
    // v5-aligned: the weak (Haiku) judge never overrides the strong (Opus) verdict.
    expect(out.verdict).toBe("verified");
    expect(out.notes).toContain("haiku-recall-check");
    expect(out.notes).toContain("evidence does not match the claim");
    expect(out.perCondition).toEqual(opus.perCondition);
    expect(out.perCondition[0]?.met).toBe(true);
  });

  it("doubleCheck disagreement when opus=partial vs haiku=verified: verdict stays 'partial', warning surfaced", () => {
    const opus = report("partial");
    const out = applyDoubleCheck(opus, { verdict: "verified" });
    expect(out.verdict).toBe("partial");
    expect(out.notes).toContain("haiku-recall-check");
  });
});
