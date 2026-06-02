import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spec, VerificationFinding } from "@claudemax/core";
import {
  activeRunPath,
  buildVerdictArtifact,
  clearActiveRun,
  computeGate,
  markRunActive,
  readActiveRun,
  readVerdict,
  specHash,
  writeVerdict,
} from "../src/verdict-artifact.js";

function spec(conds: [string, string][] = [["cc-1", "ls"], ["cc-2", "grep"]]): Spec {
  return {
    title: "t",
    goal: "g",
    nonGoals: [],
    constraints: [],
    completionConditions: conds.map(([id, v]) => ({ id, description: id, verifyHint: v })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cmax-verdict-"));
}

describe("computeGate (default-FAIL — the single definition of done)", () => {
  it("fails when a declared condition has no finding", () => {
    const g = computeGate(
      ["cc-1", "cc-2"],
      [{ id: "cc-1", met: true, evidence: "ran ls; exit 0", confidence: 0.95 }],
      "verified",
      0.8,
    );
    expect(g.pass).toBe(false);
    expect(g.reasons.some((r) => r.includes("cc-2") && r.includes("no verifier finding"))).toBe(true);
  });

  it("fails when met but evidence is empty", () => {
    const g = computeGate(["cc-1"], [{ id: "cc-1", met: true, evidence: "   ", confidence: 0.95 }], "verified", 0.8);
    expect(g.pass).toBe(false);
    expect(g.reasons.some((r) => r.includes("evidence is empty"))).toBe(true);
  });

  it("fails when confidence is below threshold", () => {
    const g = computeGate(["cc-1"], [{ id: "cc-1", met: true, evidence: "x", confidence: 0.5 }], "verified", 0.8);
    expect(g.pass).toBe(false);
  });

  it("fails when verdict is not 'verified' even if every condition is met", () => {
    const g = computeGate(["cc-1"], [{ id: "cc-1", met: true, evidence: "x", confidence: 0.95 }], "partial", 0.8);
    expect(g.pass).toBe(false);
    expect(g.reasons.some((r) => r.includes('not "verified"'))).toBe(true);
  });

  it("fails on zero conditions (nothing verifiable)", () => {
    expect(computeGate([], [], "verified", 0.8).pass).toBe(false);
  });

  it("passes only when every condition is met-with-evidence and verdict is verified", () => {
    const g = computeGate(
      ["cc-1", "cc-2"],
      [
        { id: "cc-1", met: true, evidence: "ran ls; exit 0", confidence: 0.95 },
        { id: "cc-2", met: true, evidence: "grep found the symbol", confidence: 0.9 },
      ],
      "verified",
      0.8,
    );
    expect(g.pass).toBe(true);
    expect(g.reasons).toEqual([]);
  });
});

describe("specHash", () => {
  it("is stable for the same goal+conditions and changes when they change", () => {
    expect(specHash(spec())).toBe(specHash(spec()));
    expect(specHash(spec())).not.toBe(specHash(spec([["cc-1", "different-hint"]])));
  });
});

describe("buildVerdictArtifact + writeVerdict", () => {
  it("enumerates every declared condition and embeds a passing gate", () => {
    const a = buildVerdictArtifact({
      spec: spec(),
      allFindings: [
        { id: "cc-1", met: true, evidence: "ran ls; exit 0", confidence: 0.95 },
        { id: "cc-2", met: true, evidence: "grep ok", confidence: 0.9 },
      ],
      verdict: "verified",
      verifierTier: "opus",
      confidenceThreshold: 0.8,
      cwd: "/x",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(a.allConditionIds).toEqual(["cc-1", "cc-2"]);
    expect(a.gate.pass).toBe(true);
    expect(a.schema).toBe("cmax.verdict.v1");
    expect(a.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("an omitted condition makes the gate fail (default-FAIL) and the verdict is written to disk", () => {
    const cwd = tmp();
    const findings: VerificationFinding[] = [{ id: "cc-1", met: true, evidence: "x", confidence: 0.95 }]; // cc-2 omitted
    const { path, latestPath, artifact } = writeVerdict({
      spec: spec(),
      allFindings: findings,
      verdict: "verified",
      verifierTier: "opus",
      confidenceThreshold: 0.8,
      cwd,
    });
    expect(artifact.gate.pass).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(latestPath)).toBe(true);
    const round = readVerdict(latestPath);
    expect(round?.allConditionIds).toEqual(["cc-1", "cc-2"]);
    expect(round?.gate.pass).toBe(false);
  });
});

describe("active-run sentinel (gate engages only during an autonomous run)", () => {
  it("mark/read/clear roundtrip", () => {
    const cwd = tmp();
    const s = spec();
    expect(readActiveRun(cwd)).toBeNull();
    const run = markRunActive(s, cwd, "2026-01-01T00:00:00.000Z");
    expect(run.specHash).toBe(specHash(s));
    expect(readActiveRun(cwd)?.specHash).toBe(specHash(s));
    expect(existsSync(activeRunPath(cwd))).toBe(true);
    clearActiveRun(cwd);
    expect(readActiveRun(cwd)).toBeNull();
  });
});
