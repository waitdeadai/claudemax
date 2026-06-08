import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MultiSpec, Spec, VerificationReport } from "@claudemax/core";
import { runPipelineLoop } from "./pipeline-loop.js";
import type { GoalRunResult } from "./goal.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cmax-ploop-"));
}

function sub(title: string): Spec {
  return {
    title,
    goal: title,
    nonGoals: [],
    constraints: [],
    completionConditions: [{ id: `${title}-cc`, description: title, verifyHint: "test" }],
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-06-08T00:00:00Z",
  };
}

function multispec(rootGoal: string, subs: Spec[], rollupIds: string[]): MultiSpec {
  return {
    rootGoal,
    subSpecs: subs,
    dependencies: [],
    rollupCompletionConditions: rollupIds.map((id) => ({ id, description: id, verifyHint: "test" })),
    writeSetByspecId: {},
    mode: "solo",
    modeReason: "test",
    createdAt: "2026-06-08T00:00:00Z",
  };
}

function goalResult(over: Partial<GoalRunResult> = {}): GoalRunResult {
  return {
    status: "finished",
    summary: "ok",
    evidence: {},
    turns: 2,
    tokensIn: 500,
    tokensOut: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  };
}

function rollup(verdict: VerificationReport["verdict"], metIds: string[], allIds: string[]): VerificationReport {
  const root: Spec = {
    title: "root",
    goal: "root",
    nonGoals: [],
    constraints: [],
    completionConditions: allIds.map((id) => ({ id, description: id, verifyHint: "test" })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-06-08T00:00:00Z",
  };
  return {
    spec: root,
    perCondition: allIds.map((id) => ({
      id,
      met: metIds.includes(id),
      evidence: metIds.includes(id) ? "verified" : "",
      confidence: 0.95,
    })),
    suppressedLowConfidence: [],
    verdict,
    verifierTier: "opus",
    notes: "",
    confidenceThreshold: 0.8,
  };
}

describe("runPipelineLoop", () => {
  it("researches+decomposes once, loops goal+verify, converges to done", async () => {
    let research = 0;
    let decompose = 0;
    let verifyPass = 0;
    const subs = [sub("a"), sub("b")];
    const res = await runPipelineLoop("build the thing", {
      cwd: tmp(),
      researchFn: async () => {
        research++;
        return undefined;
      },
      decomposeFn: async () => {
        decompose++;
        return multispec("build the thing", subs, ["r1", "r2"]);
      },
      goalFn: async () => goalResult(),
      verifyRollupFn: async () => {
        verifyPass++;
        return verifyPass >= 2
          ? rollup("verified", ["r1", "r2"], ["r1", "r2"])
          : rollup("partial", ["r1"], ["r1", "r2"]);
      },
    });
    expect(res.finalAction).toBe("done");
    expect(research).toBe(1); // deepresearch ran ONCE in CONSTRUCT
    expect(decompose).toBe(1); // decompose ran ONCE (no respec)
    expect(res.passes.length).toBe(2);
  });

  it("only re-runs sub-Specs the executor has not finished (frontier)", async () => {
    const subs = [sub("a"), sub("b")];
    const ranTitles: string[] = [];
    let verifyPass = 0;
    await runPipelineLoop("g", {
      cwd: tmp(),
      researchFn: async () => undefined,
      decomposeFn: async () => multispec("g", subs, ["r1"]),
      goalFn: async (s) => {
        ranTitles.push(`${verifyPass}:${s.title}`);
        // 'a' finishes immediately; 'b' never reports finished.
        return s.title === "a" ? goalResult({ status: "finished" }) : goalResult({ status: "max-turns" });
      },
      verifyRollupFn: async () => {
        verifyPass++;
        return verifyPass >= 2 ? rollup("verified", ["r1"], ["r1"]) : rollup("partial", [], ["r1"]);
      },
    });
    // Pass 1 runs both; pass 2 runs only 'b' (a was finished).
    expect(ranTitles).toContain("0:a");
    expect(ranTitles).toContain("0:b");
    expect(ranTitles.filter((t) => t.endsWith(":a")).length).toBe(1);
    expect(ranTitles.filter((t) => t.endsWith(":b")).length).toBe(2);
  });

  it("re-decomposes on stall (respec), then converges", async () => {
    let decompose = 0;
    let verifyPass = 0;
    const res = await runPipelineLoop("g", {
      cwd: tmp(),
      maxPasses: 20,
      respecAfterStuck: 2,
      maxRespecs: 1,
      researchFn: async () => undefined,
      decomposeFn: async () => {
        decompose++;
        return multispec(decompose >= 2 ? "g-v2" : "g", [sub("a")], ["r1"]);
      },
      goalFn: async () => goalResult({ status: "max-turns" }),
      verifyRollupFn: async () => {
        verifyPass++;
        // Stuck (partial, no progress) until after the re-decompose, then verified.
        return decompose >= 2 ? rollup("verified", ["r1"], ["r1"]) : rollup("partial", [], ["r1"]);
      },
    });
    expect(res.respecs).toBe(1);
    expect(decompose).toBe(2); // initial + one re-decompose
    expect(res.finalAction).toBe("done");
  });

  it("stops on the pass ceiling when it cannot converge", async () => {
    let verifyPass = 0;
    const res = await runPipelineLoop("g", {
      cwd: tmp(),
      maxPasses: 3,
      respecAfterStuck: 99, // disable respec so the ceiling trips
      researchFn: async () => undefined,
      decomposeFn: async () => multispec("g", [sub("a")], ["r1"]),
      goalFn: async () => goalResult({ status: "max-turns" }),
      verifyRollupFn: async () => {
        verifyPass++;
        return rollup("partial", [], ["r1"]);
      },
    });
    expect(res.finalAction).toBe("stop-max");
    expect(res.passes.length).toBe(3);
  });
});
