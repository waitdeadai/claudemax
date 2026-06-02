import { describe, expect, it } from "vitest";
import type { MultiSpec, Spec } from "@claudemax/core";
import {
  PRC_CONDITIONS,
  augmentMultiSpecWithPRC,
  augmentSpecWithPRC,
  isPRCCondition,
} from "../src/prc.js";

function spec(id = "s1"): Spec {
  return {
    title: id,
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: [{ id: `${id}-cc1`, description: "d", verifyHint: "check" }],
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function multispec(): MultiSpec {
  return {
    rootGoal: "g",
    subSpecs: [spec("a"), spec("b")],
    dependencies: [],
    rollupCompletionConditions: [{ id: "roll-1", description: "d", verifyHint: "e2e check" }],
    writeSetByspecId: {},
    mode: "solo",
    modeReason: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("augmentSpecWithPRC", () => {
  it("appends every PRC condition with a mechanical verifyHint, preserving originals", () => {
    const out = augmentSpecWithPRC(spec());
    expect(out.completionConditions[0]!.id).toBe("s1-cc1");
    for (const c of PRC_CONDITIONS) {
      const got = out.completionConditions.find((x) => x.id === c.id);
      expect(got).toBeTruthy();
      expect(got!.verifyHint.trim().length).toBeGreaterThan(10);
    }
  });

  it("is idempotent (no duplicate PRC ids when re-augmented)", () => {
    const once = augmentSpecWithPRC(spec());
    const twice = augmentSpecWithPRC(once);
    const ids = twice.completionConditions.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.completionConditions.length).toBe(once.completionConditions.length);
  });
});

describe("augmentMultiSpecWithPRC", () => {
  it("augments every sub-Spec and the rollup by default", () => {
    const out = augmentMultiSpecWithPRC(multispec());
    for (const s of out.subSpecs) {
      for (const c of PRC_CONDITIONS) {
        expect(s.completionConditions.some((x) => x.id === c.id)).toBe(true);
      }
    }
    for (const c of PRC_CONDITIONS) {
      expect(out.rollupCompletionConditions.some((x) => x.id === c.id)).toBe(true);
    }
  });

  it("--mvp opts out: returns the multispec unchanged", () => {
    const input = multispec();
    const out = augmentMultiSpecWithPRC(input, { mvp: true });
    expect(out).toBe(input);
    expect(out.subSpecs[0]!.completionConditions).toHaveLength(1);
  });
});

describe("isPRCCondition", () => {
  it("recognizes prc- ids and rejects others", () => {
    expect(isPRCCondition(PRC_CONDITIONS[0]!)).toBe(true);
    expect(isPRCCondition({ id: "feature-x", description: "", verifyHint: "" })).toBe(false);
  });
});
