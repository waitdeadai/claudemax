import { describe, expect, it } from "vitest";
import type { Spec } from "@claudemax/core";
import {
  computeVerdictStrict,
  enforceEvidence,
  fillMissingConditions,
  mapWithConcurrency,
  verifyDecomposed,
  withTimeout,
  type ConditionRunner,
  type RawFinding,
} from "../src/verify.js";

function spec(ids: string[]): Spec {
  return {
    title: "t",
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: ids.map((id) => ({ id, description: id, verifyHint: "check" })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("mapWithConcurrency", () => {
  it("preserves order and runs every item under a bounded pool", async () => {
    const seen: number[] = [];
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("resolves the factory value when it beats the timer", async () => {
    expect(await withTimeout(async () => "ok", 1000, () => "timeout")).toBe("ok");
  });

  it("returns onTimeout and aborts the signal when the factory hangs", async () => {
    let aborted = false;
    const v = await withTimeout(
      (signal) =>
        new Promise<string>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      20,
      () => "timeout",
    );
    expect(v).toBe("timeout");
    expect(aborted).toBe(true);
  });

  it("treats a factory rejection as timeout (default-FAIL, never throws)", async () => {
    const v = await withTimeout(
      async () => {
        throw new Error("boom");
      },
      1000,
      () => "fail",
    );
    expect(v).toBe("fail");
  });
});

describe("verifyDecomposed (Frente B.1 — parallel per-condition, hard timeout)", () => {
  it("produces exactly one finding per condition; a hung condition times out to met:false", async () => {
    const s = spec(["a", "b", "c"]);
    const runner: ConditionRunner = (cc) => {
      if (cc.id === "b") return new Promise<RawFinding>(() => {}); // never resolves → must time out
      return Promise.resolve({
        id: cc.id,
        met: true,
        evidence: `ran check for ${cc.id}; exit 0`,
        confidence: 0.95,
      });
    };
    const findings = await verifyDecomposed(s, new Map(), runner, {
      perConditionTimeoutMs: 30,
      maxParallel: 3,
    });
    expect(findings.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    const b = findings.find((f) => f.id === "b")!;
    expect(b.met).toBe(false);
    expect(b.timedOut).toBe(true);
    expect(findings.find((f) => f.id === "a")!.met).toBe(true);
  });
});

describe("default-FAIL completeness + evidence-required + strict verdict", () => {
  it("fills a missing condition as default-FAIL, preserving spec order", () => {
    const out = fillMissingConditions(spec(["a", "b"]), [
      { id: "a", met: true, evidence: "x", confidence: 0.9 },
    ]);
    expect(out.map((f) => f.id)).toEqual(["a", "b"]);
    expect(out.find((f) => f.id === "b")!.met).toBe(false);
  });

  it("downgrades a met-without-evidence finding to not-met", () => {
    const out = enforceEvidence([{ id: "a", met: true, evidence: "   ", confidence: 0.9 }]);
    expect(out[0]!.met).toBe(false);
  });

  it("verified only when every condition is met-with-evidence at threshold", () => {
    const s = spec(["a", "b"]);
    expect(
      computeVerdictStrict(
        s,
        [
          { id: "a", met: true, evidence: "x", confidence: 0.9 },
          { id: "b", met: true, evidence: "y", confidence: 0.9 },
        ],
        0.8,
      ),
    ).toBe("verified");
    expect(
      computeVerdictStrict(
        s,
        [
          { id: "a", met: true, evidence: "x", confidence: 0.9 },
          { id: "b", met: false, evidence: "", confidence: 0.9 },
        ],
        0.8,
      ),
    ).toBe("partial");
    // a fails the confidence floor, b not met → 0 passed → failed
    expect(
      computeVerdictStrict(
        s,
        [
          { id: "a", met: true, evidence: "x", confidence: 0.5 },
          { id: "b", met: false, evidence: "", confidence: 0.9 },
        ],
        0.8,
      ),
    ).toBe("failed");
    expect(computeVerdictStrict(spec([]), [], 0.8)).toBe("unverified");
  });
});
