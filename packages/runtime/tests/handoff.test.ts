import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHandoff, renderHandoffPrompt, writeHandoff } from "../src/handoff.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "claudemax-handoff-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("handoff round-trip", () => {
  it("writes and reads a handoff for a phase", () => {
    const written = writeHandoff({
      cwd,
      rootGoal: "demo",
      phase: "decompose",
      previousPhase: "deepresearch",
      summary: "produced 3 sub-Specs",
      nextInputs: ["sub-a", "sub-b", "sub-c"],
      artifacts: { rootSpecPath: "SPEC.md" },
    });
    const round = readHandoff("decompose", cwd);
    expect(round).not.toBeNull();
    expect(round?.summary).toBe("produced 3 sub-Specs");
    expect(round?.nextInputs).toEqual(["sub-a", "sub-b", "sub-c"]);
    expect(round?.previousPhase).toBe("deepresearch");
    expect(round?.createdAt).toBe(written.createdAt);
  });

  it("returns null when no handoff written for the phase", () => {
    expect(readHandoff("verify-rollup", cwd)).toBeNull();
  });

  it("renderHandoffPrompt produces a stable, readable prompt", () => {
    writeHandoff({
      cwd,
      rootGoal: "demo",
      phase: "goal",
      previousPhase: "decompose",
      summary: "all sub-Specs finished",
      nextInputs: ["run verify"],
      blockers: [],
      artifacts: { count: "3" },
    });
    const h = readHandoff("goal", cwd)!;
    const prompt = renderHandoffPrompt(h);
    expect(prompt).toContain("previous phase: decompose");
    expect(prompt).toContain("this phase:     goal");
    expect(prompt).toContain("root goal:      demo");
    expect(prompt).toContain("all sub-Specs finished");
    expect(prompt).toContain("- count: 3");
    expect(prompt).toContain("blockers carried forward:\n  (none)");
  });

  it("multiple phases each get their own file", () => {
    writeHandoff({
      cwd,
      rootGoal: "demo",
      phase: "deepresearch",
      summary: "5 sources",
      nextInputs: [],
    });
    writeHandoff({
      cwd,
      rootGoal: "demo",
      phase: "decompose",
      previousPhase: "deepresearch",
      summary: "3 sub-Specs",
      nextInputs: [],
    });
    expect(readHandoff("deepresearch", cwd)?.summary).toBe("5 sources");
    expect(readHandoff("decompose", cwd)?.summary).toBe("3 sub-Specs");
  });
});
