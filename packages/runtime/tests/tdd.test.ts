import { describe, expect, it } from "vitest";
import { parseTddBlock } from "../src/tdd.js";

describe("parseTddBlock", () => {
  it("parses a canonical FINAL TDD BLOCK", () => {
    const raw = `Some narrative noise from the model.

FINAL TDD BLOCK
PHASE: test-passes
FAILING TEST PATH: packages/runtime/tests/cc.test.ts
EVIDENCE:
- pnpm test --filter @claudemax/runtime: exit 0
- packages/runtime/tests/cc.test.ts asserts the completion condition
- packages/runtime/src/runner.ts implements the behavior
NOTES: cycle finished cleanly; assertion was authored before the implementation change.`;
    const r = parseTddBlock(raw, 42);
    expect(r.phase).toBe("test-passes");
    expect(r.turnsUsed).toBe(42);
    expect(r.failingTestPath).toBe("packages/runtime/tests/cc.test.ts");
    expect(r.evidence).toHaveLength(3);
    expect(r.evidence[0]).toContain("exit 0");
    expect(r.notes).toContain("authored before");
  });

  it("returns stalled when no FINAL TDD BLOCK present", () => {
    const r = parseTddBlock("I gave up", 10);
    expect(r.phase).toBe("stalled");
    expect(r.turnsUsed).toBe(10);
  });

  it("treats 'FAILING TEST PATH: none' as no path", () => {
    const raw = `FINAL TDD BLOCK
PHASE: stalled
FAILING TEST PATH: none
EVIDENCE:
- could not author a failing test for behavioral verifyHint
NOTES: behavior verifyHint requires interactive probe, not a test command.`;
    const r = parseTddBlock(raw, 5);
    expect(r.failingTestPath).toBeUndefined();
    expect(r.phase).toBe("stalled");
  });

  it("accepts each of the four declared phases", () => {
    for (const phase of ["failing-test-written", "implementation-done", "test-passes", "stalled"]) {
      const raw = `FINAL TDD BLOCK
PHASE: ${phase}
FAILING TEST PATH: none
EVIDENCE:
- noop
NOTES: noop`;
      expect(parseTddBlock(raw, 0).phase).toBe(phase);
    }
  });
});
