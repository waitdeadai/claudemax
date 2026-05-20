import { describe, expect, it } from "vitest";
import type { Spec, VerificationReport } from "@claudemax/core";
import {
  rollupVerdict,
  selectParallelMode,
  topologicalLeafFrontier,
} from "../src/multispec.js";

function spec(title: string): Spec {
  return {
    title,
    goal: `Goal: ${title}`,
    nonGoals: [],
    constraints: [],
    completionConditions: [
      { id: `${title}-cc1`, description: "...", verifyHint: "ls" },
    ],
    assumptions: [],
    evidenceRequired: [],
    createdAt: new Date().toISOString(),
  };
}

function verification(
  title: string,
  verdict: "verified" | "partial" | "failed",
): VerificationReport {
  return {
    spec: spec(title),
    perCondition: [{ id: `${title}-cc1`, met: verdict === "verified", evidence: "x" }],
    verdict,
    verifierTier: "opus",
    notes: "",
  };
}

describe("selectParallelMode", () => {
  it("≤5 sub-Specs, non-overlapping write sets → solo", () => {
    const ws = { a: ["src/a.ts"], b: ["src/b.ts"], c: ["src/c.ts"] };
    const r = selectParallelMode([spec("a"), spec("b"), spec("c")], ws);
    expect(r.mode).toBe("solo");
    expect(r.reason).toContain("no overlap");
  });

  it(">5 sub-Specs → teams", () => {
    const subs = Array.from({ length: 7 }, (_, i) => spec(`s${i}`));
    const ws: Record<string, readonly string[]> = {};
    for (const s of subs) ws[s.title] = [`src/${s.title}.ts`];
    const r = selectParallelMode(subs, ws);
    expect(r.mode).toBe("teams");
    expect(r.reason).toContain("subSpecs=7");
  });

  it("overlapping write sets → teams", () => {
    const ws = { a: ["src/shared.ts"], b: ["src/shared.ts", "src/b.ts"] };
    const r = selectParallelMode([spec("a"), spec("b")], ws);
    expect(r.mode).toBe("teams");
    expect(r.reason).toContain("write-set overlap");
  });

  it("est time > 30 min → teams (driven by subSpec count × 8min)", () => {
    const subs = Array.from({ length: 5 }, (_, i) => spec(`s${i}`));
    const ws: Record<string, readonly string[]> = {};
    for (const s of subs) ws[s.title] = [`src/${s.title}.ts`];
    const r = selectParallelMode(subs, ws);
    expect(r.mode).toBe("teams");
    expect(r.reason).toContain("est=40min");
  });

  it("forced override 'solo' wins regardless of triggers", () => {
    const subs = Array.from({ length: 10 }, (_, i) => spec(`s${i}`));
    const ws: Record<string, readonly string[]> = {};
    for (const s of subs) ws[s.title] = [`src/shared.ts`];
    const r = selectParallelMode(subs, ws, "solo");
    expect(r.mode).toBe("solo");
    expect(r.reason).toContain("forced");
  });

  it("forced override 'teams' wins for small specs too", () => {
    const r = selectParallelMode([spec("a")], { a: ["src/a.ts"] }, "teams");
    expect(r.mode).toBe("teams");
    expect(r.reason).toContain("forced");
  });
});

describe("topologicalLeafFrontier", () => {
  it("returns all nodes when no dependencies", () => {
    const frontier = topologicalLeafFrontier(new Set(["a", "b", "c"]), []);
    expect(frontier.sort()).toEqual(["a", "b", "c"]);
  });

  it("only returns nodes whose dependencies are satisfied", () => {
    const deps = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ];
    const frontier = topologicalLeafFrontier(new Set(["a", "b", "c"]), deps);
    expect(frontier.sort()).toEqual(["b", "c"]);
  });

  it("frontier advances as nodes drop out", () => {
    const deps = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const remaining = new Set(["a", "b", "c"]);
    expect(topologicalLeafFrontier(remaining, deps)).toEqual(["c"]);
    remaining.delete("c");
    expect(topologicalLeafFrontier(remaining, deps)).toEqual(["b"]);
    remaining.delete("b");
    expect(topologicalLeafFrontier(remaining, deps)).toEqual(["a"]);
  });
});

describe("rollupVerdict", () => {
  it("rollup failed → failed regardless of sub-specs", () => {
    const subs = [verification("a", "verified"), verification("b", "verified")];
    const v = rollupVerdict(subs, verification("rollup", "failed"));
    expect(v).toBe("failed");
  });

  it("all sub-specs verified + rollup verified → verified", () => {
    const subs = [verification("a", "verified"), verification("b", "verified")];
    const v = rollupVerdict(subs, verification("rollup", "verified"));
    expect(v).toBe("verified");
  });

  it("some sub-specs verified, some not → partial", () => {
    const subs = [verification("a", "verified"), verification("b", "partial")];
    const v = rollupVerdict(subs, verification("rollup", "verified"));
    expect(v).toBe("partial");
  });

  it("all sub-specs failed → failed", () => {
    const subs = [verification("a", "failed"), verification("b", "failed")];
    const v = rollupVerdict(subs, verification("rollup", "partial"));
    expect(v).toBe("failed");
  });
});
