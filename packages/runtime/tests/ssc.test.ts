import { describe, expect, it } from "vitest";
import type { Spec, VerificationFinding, VerificationReport } from "@claudemax/core";
import {
  applyHardening,
  detectEasyPass,
  hardenSpec,
  type HardeningPlan,
  type SpecHardener,
} from "../src/ssc.js";

function spec(conds: [string, string, string][] = [["cc-1", "do a", "ls"]]): Spec {
  return {
    title: "t",
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: conds.map(([id, description, verifyHint]) => ({ id, description, verifyHint })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function report(
  verdict: VerificationReport["verdict"],
  perCondition: VerificationFinding[],
  s: Spec = spec(),
): VerificationReport {
  return {
    spec: s,
    perCondition,
    suppressedLowConfidence: [],
    verdict,
    verifierTier: "opus",
    notes: "",
    confidenceThreshold: 0.8,
  };
}

describe("applyHardening", () => {
  it("tightens matching verifyHints and appends new conditions, never touching the goal", () => {
    const s = spec([["cc-1", "do a", "check it works"]]);
    const plan: HardeningPlan = {
      tightened: [{ id: "cc-1", verifyHint: "named test test_a passes incl. empty-input edge case", why: "was vague" }],
      added: [{ id: "h-1", description: "handles invalid input", verifyHint: "test_a_invalid rejects bad input" }],
      notes: "",
    };
    const { hardened, changes } = applyHardening(s, plan);
    expect(hardened.goal).toBe("g");
    expect(hardened.completionConditions.find((c) => c.id === "cc-1")!.verifyHint).toContain("named test");
    expect(hardened.completionConditions.some((c) => c.id === "h-1")).toBe(true);
    expect(changes.some((c) => c.includes("tightened cc-1"))).toBe(true);
    expect(changes.some((c) => c.includes("added h-1"))).toBe(true);
  });

  it("does not duplicate an added condition whose id already exists", () => {
    const plan: HardeningPlan = { tightened: [], added: [{ id: "cc-1", description: "dup", verifyHint: "y" }], notes: "" };
    const { hardened } = applyHardening(spec([["cc-1", "a", "x"]]), plan);
    expect(hardened.completionConditions).toHaveLength(1);
  });
});

describe("hardenSpec (injected hardener)", () => {
  it("applies the injected plan", async () => {
    const fake: SpecHardener = async () => ({
      tightened: [{ id: "cc-1", verifyHint: "runs test_x; exit 0", why: "vague" }],
      added: [],
      notes: "",
    });
    const { hardened, changes } = await hardenSpec(spec(), { hardener: fake });
    expect(hardened.completionConditions[0]!.verifyHint).toBe("runs test_x; exit 0");
    expect(changes).toHaveLength(1);
  });
});

describe("detectEasyPass", () => {
  it("is not suspicious when the verdict isn't 'verified'", () => {
    expect(detectEasyPass(spec(), report("partial", [])).suspicious).toBe(false);
  });

  it("flags thin evidence on a verified verdict", () => {
    const s = spec([["cc-1", "a", "run test_a covering edge cases"]]);
    const r = detectEasyPass(s, report("verified", [{ id: "cc-1", met: true, evidence: "ok", confidence: 0.95 }], s));
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(" ")).toContain("thin");
  });

  it("flags a happy-path-only spec (no PRC, no rigor) even with adequate evidence", () => {
    const s = spec([["cc-1", "show the landing page", "the landing page shows the heading and the primary call-to-action button"]]);
    const r = detectEasyPass(
      s,
      report(
        "verified",
        [
          {
            id: "cc-1",
            met: true,
            evidence: "opened the landing page and confirmed the heading and the call-to-action button are visible",
            confidence: 0.95,
          },
        ],
        s,
      ),
    );
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(" ")).toContain("happy-path-only");
  });

  it("is not suspicious with rich evidence and a rigor verifyHint", () => {
    const s = spec([["cc-1", "a", "named test test_a passes including an empty-input edge case and a failure-mode assertion"]]);
    const r = detectEasyPass(
      s,
      report(
        "verified",
        [
          {
            id: "cc-1",
            met: true,
            evidence: "ran `vitest test_a`; exit 0; covers empty-input and invalid-input failure paths",
            confidence: 0.95,
          },
        ],
        s,
      ),
    );
    expect(r.suspicious).toBe(false);
  });
});
