import { describe, expect, it } from "vitest";
import type { VerificationFinding } from "@claudemax/core";
import {
  consolidateSimilar,
  normalizeFindings,
  partitionByConfidence,
  type RawFinding,
} from "../src/verify.js";

describe("normalizeFindings", () => {
  it("clamps confidence to [0,1] and defaults missing values to 0.5", () => {
    const raw: RawFinding[] = [
      { id: "a", met: true, evidence: "ok" },
      { id: "b", met: true, evidence: "ok", confidence: 2 },
      { id: "c", met: true, evidence: "ok", confidence: -1 },
    ];
    const n = normalizeFindings(raw);
    expect(n[0]?.confidence).toBe(0.5);
    expect(n[1]?.confidence).toBe(1);
    expect(n[2]?.confidence).toBe(0);
  });

  it("strips actionableNext and failureCategory when met=true", () => {
    const raw: RawFinding[] = [
      {
        id: "a",
        met: true,
        evidence: "ok",
        confidence: 0.9,
        actionableNext: "do nothing",
        failureCategory: "test-failure",
      },
    ];
    const n = normalizeFindings(raw);
    expect(n[0]?.actionableNext).toBeUndefined();
    expect(n[0]?.failureCategory).toBeUndefined();
  });

  it("coerces unknown failureCategory to 'unknown'", () => {
    const raw: RawFinding[] = [
      {
        id: "a",
        met: false,
        evidence: "missing",
        confidence: 0.9,
        failureCategory: "not-a-real-category",
        actionableNext: "fix it",
      },
    ];
    const n = normalizeFindings(raw);
    expect(n[0]?.failureCategory).toBe("unknown");
  });
});

describe("partitionByConfidence", () => {
  it("keeps findings >= threshold, suppresses below", () => {
    const findings: VerificationFinding[] = [
      { id: "a", met: true, evidence: "x", confidence: 0.95 },
      { id: "b", met: true, evidence: "x", confidence: 0.79 },
      { id: "c", met: true, evidence: "x", confidence: 0.8 },
    ];
    const { kept, suppressed } = partitionByConfidence(findings, 0.8);
    expect(kept.map((f) => f.id)).toEqual(["a", "c"]);
    expect(suppressed.map((f) => f.id)).toEqual(["b"]);
  });
});

describe("consolidateSimilar", () => {
  it("merges failing findings with same category + same root file", () => {
    const findings: VerificationFinding[] = [
      {
        id: "cc-1",
        met: false,
        evidence: "src/auth.ts is missing the export",
        confidence: 0.9,
        failureCategory: "missing-file",
      },
      {
        id: "cc-2",
        met: false,
        evidence: "src/auth.ts export still absent",
        confidence: 0.9,
        failureCategory: "missing-file",
      },
      {
        id: "cc-3",
        met: false,
        evidence: "src/billing.ts has a type error",
        confidence: 0.9,
        failureCategory: "type-error",
      },
    ];
    const out = consolidateSimilar(findings);
    expect(out).toHaveLength(2);
    const merged = out.find((f) => f.id === "cc-1");
    expect(merged?.consolidatedFrom).toEqual(["cc-2"]);
    expect(merged?.evidence).toContain("consolidated with 1 other");
  });

  it("does not merge passing findings", () => {
    const findings: VerificationFinding[] = [
      { id: "cc-1", met: true, evidence: "src/a.ts ok", confidence: 0.95 },
      { id: "cc-2", met: true, evidence: "src/a.ts also ok", confidence: 0.95 },
    ];
    const out = consolidateSimilar(findings);
    expect(out).toHaveLength(2);
  });
});
