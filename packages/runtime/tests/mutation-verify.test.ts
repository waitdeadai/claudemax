import { describe, expect, it } from "vitest";
import type { Spec, SpecCompletionCondition, VerificationFinding } from "@claudemax/core";
import {
  adversarialVerify,
  adversarialVerifyCondition,
  applyAdversarialDowngrade,
  generateMutants,
  isomorphicRestate,
  scoreAdversarial,
  type AdversarialJudges,
  type Mutant,
  type MutantOutcome,
} from "../src/mutation-verify.js";

function cc(id: string): SpecCompletionCondition {
  return { id, description: `do ${id}`, verifyHint: `check ${id}` };
}
function spec(ids: string[]): Spec {
  return {
    title: "t",
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: ids.map(cc),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function outcomes(rej: boolean[]): MutantOutcome[] {
  return rej.map((r, i) => ({
    mutantId: `a#m${i}`,
    kind: "false-claim-no-evidence" as const,
    rejected: r,
    note: "",
  }));
}

describe("generateMutants", () => {
  it("produces 3 distinct fabricated-claim mutants per condition", () => {
    const m = generateMutants(cc("a"));
    expect(m).toHaveLength(3);
    expect(new Set(m.map((x) => x.kind)).size).toBe(3);
    expect(m.every((x) => x.id.startsWith("a#"))).toBe(true);
  });
});

describe("scoreAdversarial", () => {
  it("robust when all mutants rejected and isomorphically stable", () => {
    const r = scoreAdversarial("a", outcomes([true, true, true]), true);
    expect(r.gameable).toBe(false);
    expect(r.rejectionRate).toBe(1);
  });
  it("gameable when any fabricated claim is accepted", () => {
    expect(scoreAdversarial("a", outcomes([true, false, true]), true).gameable).toBe(true);
  });
  it("gameable when isomorphically unstable even if all mutants rejected", () => {
    expect(scoreAdversarial("a", outcomes([true, true, true]), false).gameable).toBe(true);
  });
});

describe("adversarialVerifyCondition (injected judges)", () => {
  const robust: AdversarialJudges = {
    judgeMutant: async () => true,
    judgeIsomorphic: async () => true,
  };
  const fooled: AdversarialJudges = {
    judgeMutant: async (_c, m: Mutant) => m.kind !== "hardcoded-visible-case",
    judgeIsomorphic: async () => true,
  };

  it("not gameable when the verifier rejects every fabrication", async () => {
    const r = await adversarialVerifyCondition(spec(["a"]), cc("a"), { judges: robust });
    expect(r.gameable).toBe(false);
  });
  it("gameable when the verifier accepts a fabrication", async () => {
    const r = await adversarialVerifyCondition(spec(["a"]), cc("a"), { judges: fooled });
    expect(r.gameable).toBe(true);
    expect(r.mutantsRejected).toBe(2);
  });
  it("adversarialVerify only covers the requested condition ids", async () => {
    const results = await adversarialVerify(spec(["a", "b"]), ["a"], { judges: robust });
    expect(results.map((r) => r.conditionId)).toEqual(["a"]);
  });
});

describe("applyAdversarialDowngrade", () => {
  it("downgrades a MET finding whose condition was found gameable", () => {
    const findings: VerificationFinding[] = [
      { id: "a", met: true, evidence: "ran check a; exit 0", confidence: 0.95 },
      { id: "b", met: true, evidence: "ran check b; exit 0", confidence: 0.95 },
    ];
    const results = [
      scoreAdversarial("a", outcomes([false]), true), // gameable
      scoreAdversarial("b", outcomes([true]), true), // robust
    ];
    const out = applyAdversarialDowngrade(findings, results);
    expect(out.find((f) => f.id === "a")!.met).toBe(false);
    expect(out.find((f) => f.id === "a")!.failureCategory).toBe("behavior-mismatch");
    expect(out.find((f) => f.id === "b")!.met).toBe(true);
  });
});

describe("isomorphicRestate", () => {
  it("rephrases the hint and references a counterexample search", () => {
    const r = isomorphicRestate("the login form renders");
    expect(r).toContain("the login form renders");
    expect(r.toLowerCase()).toContain("counterexample");
  });
});
