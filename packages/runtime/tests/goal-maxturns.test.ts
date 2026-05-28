import { describe, expect, it } from "vitest";
import type { Spec } from "@claudemax/core";
import { runGoal } from "../src/goal.js";

// Regression for the cmax-goal overrun (2026-05-28): a run capped at 150 turns
// reached 235+ because the SDK's maxTurns option does not bound a goal loop that
// fans out via the Agent tool. runGoal now enforces the cap deterministically.

const spec = (): Spec => ({
  title: "t",
  goal: "g",
  nonGoals: [],
  constraints: [],
  completionConditions: [{ id: "cc-1", description: "d", verifyHint: "ls" }],
  assumptions: [],
  evidenceRequired: [],
  createdAt: new Date().toISOString(),
});

describe("runGoal — deterministic --max-turns cap", () => {
  it("aborts exactly at maxTurns even when the model would keep emitting turns", async () => {
    let yielded = 0;
    async function* fakeQuery() {
      for (let i = 0; i < 100; i++) {
        yielded += 1;
        yield { type: "assistant" };
      }
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }
    const r = await runGoal(spec(), { maxTurns: 5, queryFn: fakeQuery as never });
    expect(r.turns).toBe(5);
    expect(r.status).toBe("max-turns");
    // proves we broke early instead of draining all 100 model turns
    expect(yielded).toBeLessThanOrEqual(5);
  });

  it("does not prematurely cap a short run that finishes before the bound", async () => {
    async function* fakeQuery() {
      yield { type: "assistant" };
      yield { type: "assistant" };
      yield { type: "result", result: "FINISHED\n- cc-1: ok\nSUMMARY: done", usage: {} };
    }
    const r = await runGoal(spec(), { maxTurns: 50, queryFn: fakeQuery as never });
    expect(r.turns).toBe(2);
    expect(r.status).toBe("finished");
  });
});
