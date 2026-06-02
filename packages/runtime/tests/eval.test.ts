import { describe, expect, it } from "vitest";
import {
  computeEvalMetrics,
  renderAblationReport,
  runAblations,
  runEval,
  type EvalCase,
  type EvalDeps,
  type EvalOutcome,
} from "../src/eval.js";

describe("computeEvalMetrics", () => {
  it("production-hotfix-rate = of claimed-done, the fraction with a post-done defect", () => {
    const outcomes: EvalOutcome[] = [
      { caseId: "a", pipelineVerdict: "verified", hotfixDefects: 0 },
      { caseId: "b", pipelineVerdict: "verified", hotfixDefects: 2 },
      { caseId: "c", pipelineVerdict: "failed", hotfixDefects: 5 },
    ];
    const m = computeEvalMetrics(outcomes);
    expect(m.n).toBe(3);
    expect(m.claimedDone).toBe(2);
    expect(m.productionHotfixRate).toBeCloseTo(0.5); // b broke after "done"; c was never claimed done
  });

  it("verifier false-positive rate = of human-fail, the fraction the pipeline marked verified", () => {
    const m = computeEvalMetrics([
      { caseId: "a", pipelineVerdict: "verified", hotfixDefects: 0, humanVerdict: "fail" },
      { caseId: "b", pipelineVerdict: "failed", hotfixDefects: 0, humanVerdict: "fail" },
      { caseId: "c", pipelineVerdict: "verified", hotfixDefects: 0, humanVerdict: "pass" },
    ]);
    expect(m.verifierFalsePositiveRate).toBeCloseTo(0.5);
  });

  it("never divides by zero (no claimed-done / no human-fail)", () => {
    const m = computeEvalMetrics([{ caseId: "a", pipelineVerdict: "failed", hotfixDefects: 0 }]);
    expect(m.productionHotfixRate).toBe(0);
    expect(m.verifierFalsePositiveRate).toBe(0);
    expect(m.verdictBreakdown["failed"]).toBe(1);
  });
});

describe("runEval / runAblations (injected deps)", () => {
  const cases: EvalCase[] = [
    { id: "x", goal: "g1", hiddenChecks: ["true"] },
    { id: "y", goal: "g2", hiddenChecks: ["false"] },
  ];
  const deps: EvalDeps = {
    runPipeline: async () => ({ verdict: "verified" }),
    runHiddenChecks: async (c) => (c.id === "y" ? 1 : 0),
  };

  it("runEval records per-case outcomes and the hotfix metric", async () => {
    const r = await runEval(cases, deps, { label: "full", verify: true });
    expect(r.outcomes.map((o) => o.caseId)).toEqual(["x", "y"]);
    expect(r.metrics.productionHotfixRate).toBeCloseTo(0.5); // y was 'verified' but broke
  });

  it("runAblations runs each config and labels the results", async () => {
    const results = await runAblations(cases, deps, [
      { label: "full", verify: true },
      { label: "no-verify", verify: false },
    ]);
    expect(results.map((r) => r.ablation)).toEqual(["full", "no-verify"]);
    expect(renderAblationReport(results)).toContain("hotfix-rate");
  });
});
