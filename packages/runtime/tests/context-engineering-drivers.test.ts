// Tests for the OFF-by-default context-engineering opt-in threaded through
// runGoal (goal.ts), runPacket/dispatch (orchestrator.ts), and runOvernight
// (overnight.ts). Covers completion conditions s4a-cc1 through s4a-cc3 plus
// prc-error-handling and prc-edge-cases.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import type { Spec, DispatchPlan } from "@claudemax/core";
import { runGoal } from "../src/goal.js";
import type { GoalRunResult } from "../src/goal.js";
import { dispatch } from "../src/orchestrator.js";
import { runOvernight } from "../src/overnight.js";
import {
  buildContextEditingConfig,
  buildMemoryToolConfig,
  contextShouldDigest,
  MEMORY_TOOL_BETA,
} from "../src/context-engineering.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSpec(): Spec {
  return {
    title: "ce-driver-test",
    goal: "test context engineering threading",
    nonGoals: [],
    constraints: [],
    completionConditions: [{ id: "cc-1", description: "done", verifyHint: "echo ok" }],
    assumptions: [],
    evidenceRequired: [],
    createdAt: new Date().toISOString(),
  };
}

function makeDispatchPlan(): DispatchPlan {
  return {
    spec: makeSpec(),
    packets: [
      {
        id: "p1",
        title: "test packet",
        signal: {
          class: "implement",
          complexity: 0.3,
          novelty: 0.2,
          summary: "trivial test packet",
        },
        inputs: [],
        outputs: [],
        dependsOn: [],
      },
    ],
    parallelGroups: [["p1"]],
  };
}

// A finished goal result for use in overnight stubs.
function finishedGoalResult(): GoalRunResult {
  return {
    status: "finished",
    summary: "done",
    evidence: {},
    turns: 1,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sessionId: undefined,
  };
}

// ---------------------------------------------------------------------------
// [s4a-cc1] OFF by default — no context_management, no memory_20250818 beta
// ---------------------------------------------------------------------------

describe("[s4a-cc1] runGoal — OFF by default", () => {
  it("default options contain no context_management key", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { queryFn: captureFn as never });

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!["context_management"]).toBeUndefined();
  });

  it("default options contain no memory_20250818 beta", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { queryFn: captureFn as never });

    const betas = (capturedOptions?.["betas"] as string[] | undefined) ?? [];
    expect(betas).not.toContain(MEMORY_TOOL_BETA);
  });

  it("dispatch — default options contain no context_management key", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "STATUS: success\nEVIDENCE:\nSUMMARY: done", usage: {} };
    }

    await dispatch(makeDispatchPlan(), { queryFn: captureFn as never });

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!["context_management"]).toBeUndefined();
  });

  it("dispatch — default options contain no memory_20250818 beta", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "STATUS: success", usage: {} };
    }

    await dispatch(makeDispatchPlan(), { queryFn: captureFn as never });

    const betas = (capturedOptions?.["betas"] as string[] | undefined) ?? [];
    expect(betas).not.toContain(MEMORY_TOOL_BETA);
  });
});

// ---------------------------------------------------------------------------
// [s4a-cc2] Enabled path — protected exclusion + shouldDigest for exploration
// ---------------------------------------------------------------------------

describe("[s4a-cc2] runGoal — context_management present when opted in", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  beforeEach(() => { process.env[CE_ENV] = "1"; });
  afterEach(() => { delete process.env[CE_ENV]; });

  it("context_management is defined when contextEngineering:true", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { contextEngineering: true, queryFn: captureFn as never });

    expect(capturedOptions!["context_management"]).toBeDefined();
  });

  it("memory_20250818 beta is present when contextEngineering:true", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { contextEngineering: true, queryFn: captureFn as never });

    const betas = (capturedOptions?.["betas"] as string[] | undefined) ?? [];
    expect(betas).toContain(MEMORY_TOOL_BETA);
  });

  it("config edit.protected covers all mcp__memory__* grounding tools", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { contextEngineering: true, queryFn: captureFn as never });

    const cm = capturedOptions!["context_management"] as Record<string, unknown>;
    const edit = cm["edit"] as Record<string, unknown>;
    const protected_ = edit["protected"] as string[];

    expect(protected_).toContain("mcp__memory__memory_search");
    expect(protected_).toContain("mcp__memory__memory_get_decision");
    expect(protected_).toContain("mcp__memory__memory_get_fact");
    expect(protected_).toContain("mcp__memory__memory_stale");
  });

  it("dispatch — context_management and memory beta present when opted in", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "STATUS: success", usage: {} };
    }

    await dispatch(makeDispatchPlan(), { contextEngineering: true, queryFn: captureFn as never });

    expect(capturedOptions!["context_management"]).toBeDefined();
    const betas = (capturedOptions!["betas"] as string[] | undefined) ?? [];
    expect(betas).toContain(MEMORY_TOOL_BETA);
  });
});

// ---------------------------------------------------------------------------
// contextShouldDigest unit tests (the predicate in the edit block)
// ---------------------------------------------------------------------------

describe("[s4a-cc2] contextShouldDigest — exploration/read gate", () => {
  it("returns true for Read (exploration tool)", () => {
    expect(contextShouldDigest({ toolName: "Read" })).toBe(true);
  });

  it("returns true for Glob (exploration tool)", () => {
    expect(contextShouldDigest({ toolName: "Glob" })).toBe(true);
  });

  it("returns true for Grep (exploration tool)", () => {
    expect(contextShouldDigest({ toolName: "Grep" })).toBe(true);
  });

  it("returns false for Bash (mutation tool — never digest)", () => {
    expect(contextShouldDigest({ toolName: "Bash" })).toBe(false);
  });

  it("returns false for Write (mutation tool — never digest)", () => {
    expect(contextShouldDigest({ toolName: "Write" })).toBe(false);
  });

  it("returns false for Edit (mutation tool — never digest)", () => {
    expect(contextShouldDigest({ toolName: "Edit" })).toBe(false);
  });

  it("returns false for mcp__memory__memory_search (grounding — never clear)", () => {
    expect(contextShouldDigest({ toolName: "mcp__memory__memory_search" })).toBe(false);
  });

  it("returns false for mcp__memory__memory_get_decision (grounding — never clear)", () => {
    expect(contextShouldDigest({ toolName: "mcp__memory__memory_get_decision" })).toBe(false);
  });

  it("returns false for mcp__memory__memory_get_fact (grounding — never clear)", () => {
    expect(contextShouldDigest({ toolName: "mcp__memory__memory_get_fact" })).toBe(false);
  });

  it("returns false for mcp__memory__memory_stale (grounding — never clear)", () => {
    expect(contextShouldDigest({ toolName: "mcp__memory__memory_stale" })).toBe(false);
  });

  it("returns false when result starts with EVIDENCE: (evidence — never clear)", () => {
    expect(contextShouldDigest({ toolName: "Read", result: "EVIDENCE: some data" })).toBe(false);
  });

  it("returns false when result starts with EVIDENCE: after leading whitespace", () => {
    expect(contextShouldDigest({ toolName: "Read", result: "  EVIDENCE: some data" })).toBe(false);
  });

  it("returns false for empty toolName (safe default)", () => {
    expect(contextShouldDigest({})).toBe(false);
  });

  it("returns false for unknown/agent tool (not explicitly exploration)", () => {
    expect(contextShouldDigest({ toolName: "Agent" })).toBe(false);
  });
});

describe("[s4a-cc2] buildContextEditingConfig — shape and exclusion", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  beforeEach(() => { process.env[CE_ENV] = "1"; });
  afterEach(() => { delete process.env[CE_ENV]; });

  it("returns an object with edit.shouldDigest and edit.protected", () => {
    const config = buildContextEditingConfig();
    expect(config).toHaveProperty("edit");
    const edit = config["edit"] as Record<string, unknown>;
    expect(typeof edit["shouldDigest"]).toBe("function");
    expect(Array.isArray(edit["protected"])).toBe(true);
  });

  it("shouldDigest in config delegates to contextShouldDigest correctly", () => {
    const config = buildContextEditingConfig();
    const edit = config["edit"] as Record<string, unknown>;
    const fn = edit["shouldDigest"] as (t: { toolName?: string; result?: string }) => boolean;

    expect(fn({ toolName: "Grep" })).toBe(true);
    expect(fn({ toolName: "Bash" })).toBe(false);
    expect(fn({ toolName: "mcp__memory__memory_search" })).toBe(false);
    expect(fn({ toolName: "Read", result: "EVIDENCE: x" })).toBe(false);
  });

  it("buildMemoryToolConfig returns array containing MEMORY_TOOL_BETA", () => {
    expect(buildMemoryToolConfig()).toContain(MEMORY_TOOL_BETA);
  });
});

// ---------------------------------------------------------------------------
// [s4a-cc3] overnight.ts forwards contextEngineering to runGoal
// ---------------------------------------------------------------------------

describe("[s4a-cc3] runOvernight forwards contextEngineering flag", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cmax-ce-overnight-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forwards contextEngineering:true to goalFn", async () => {
    let capturedGoalOpts: Record<string, unknown> | undefined;

    const mockGoalFn = async (_spec: Spec, goalOpts = {}) => {
      capturedGoalOpts = goalOpts as Record<string, unknown>;
      return finishedGoalResult();
    };

    await runOvernight(makeSpec(), {
      cwd: tmpDir,
      budgetCreditsUsd: 10,
      contextEngineering: true,
      goalFn: mockGoalFn as never,
    });

    expect(capturedGoalOpts?.["contextEngineering"]).toBe(true);
  });

  it("does NOT forward contextEngineering when not specified (default undefined)", async () => {
    let capturedGoalOpts: Record<string, unknown> | undefined;

    const mockGoalFn = async (_spec: Spec, goalOpts = {}) => {
      capturedGoalOpts = goalOpts as Record<string, unknown>;
      return finishedGoalResult();
    };

    await runOvernight(makeSpec(), {
      cwd: tmpDir,
      budgetCreditsUsd: 10,
      goalFn: mockGoalFn as never,
    });

    // contextEngineering is absent / undefined — confirms OFF-by-default threading
    expect(capturedGoalOpts?.["contextEngineering"]).toBeUndefined();
  });

  it("forwards contextEngineering:false explicitly", async () => {
    let capturedGoalOpts: Record<string, unknown> | undefined;

    const mockGoalFn = async (_spec: Spec, goalOpts = {}) => {
      capturedGoalOpts = goalOpts as Record<string, unknown>;
      return finishedGoalResult();
    };

    await runOvernight(makeSpec(), {
      cwd: tmpDir,
      budgetCreditsUsd: 10,
      contextEngineering: false,
      goalFn: mockGoalFn as never,
    });

    expect(capturedGoalOpts?.["contextEngineering"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// [prc-error-handling] Graceful failure on invalid / boundary inputs
// ---------------------------------------------------------------------------

describe("[prc-error-handling] runGoal — invalid inputs fail gracefully", () => {
  it("NaN maxTurns coerces to 200 cap without crashing", async () => {
    async function* fastFn() {
      for (let i = 0; i < 210; i++) yield { type: "assistant" };
      yield { type: "result", result: "FINISHED\nSUMMARY: x", usage: {} };
    }
    const r = await runGoal(makeSpec(), { maxTurns: NaN as never, queryFn: fastFn as never });
    expect(r.turns).toBe(200);
    expect(r.status).toBe("max-turns");
  });

  it("contextEngineering:false is identical to omitting the flag (no context_management)", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    await runGoal(makeSpec(), { contextEngineering: false, queryFn: captureFn as never });

    expect(capturedOptions!["context_management"]).toBeUndefined();
    const betas = (capturedOptions?.["betas"] as string[] | undefined) ?? [];
    expect(betas).not.toContain(MEMORY_TOOL_BETA);
  });

  it("SDK error on non-turns exception is re-thrown (not swallowed)", async () => {
    async function* errorFn() {
      throw new Error("network failure");
      yield { type: "result", result: "", usage: {} }; // unreachable
    }
    await expect(
      runGoal(makeSpec(), { queryFn: errorFn as never }),
    ).rejects.toThrow("network failure");
  });
});

// ---------------------------------------------------------------------------
// [prc-edge-cases] Boundary / concurrent / combined-flag cases
// ---------------------------------------------------------------------------

describe("[prc-edge-cases] boundary and combination cases", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  beforeEach(() => { process.env[CE_ENV] = "1"; });
  afterEach(() => { delete process.env[CE_ENV]; });

  it("contextEngineering:true alongside taskBudgetTokens — both betas present", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    async function* captureFn(args: { options: Record<string, unknown> }) {
      capturedOptions = args.options;
      yield { type: "result", result: "FINISHED\nSUMMARY: done", usage: {} };
    }

    // maxBudgetUsd triggers taskBudgetTokens estimation inside baseSdkOptions
    await runGoal(makeSpec(), {
      contextEngineering: true,
      maxBudgetUsd: 5,
      queryFn: captureFn as never,
    });

    const betas = (capturedOptions?.["betas"] as string[] | undefined) ?? [];
    expect(betas).toContain("task-budgets-2026-03-13");
    expect(betas).toContain(MEMORY_TOOL_BETA);
  });

  it("contextShouldDigest handles undefined toolName and result gracefully", () => {
    expect(() => contextShouldDigest({})).not.toThrow();
    expect(contextShouldDigest({})).toBe(false);
  });

  it("contextShouldDigest handles result that only has EVIDENCE mid-string (not prefix)", () => {
    // Mid-string EVIDENCE should NOT trigger protection — only prefix
    expect(contextShouldDigest({ toolName: "Read", result: "some text EVIDENCE: here" })).toBe(true);
  });

  it("dispatch with contextEngineering:true does not double-add betas on repeated calls", async () => {
    const betasSeen: string[][] = [];
    async function* captureFn(args: { options: Record<string, unknown> }) {
      betasSeen.push((args.options["betas"] as string[] | undefined) ?? []);
      yield { type: "result", result: "STATUS: success", usage: {} };
    }

    // Run twice with the same plan
    await dispatch(makeDispatchPlan(), { contextEngineering: true, queryFn: captureFn as never });
    await dispatch(makeDispatchPlan(), { contextEngineering: true, queryFn: captureFn as never });

    // Each individual call should see exactly one occurrence of the beta
    for (const betas of betasSeen) {
      expect(betas.filter((b) => b === MEMORY_TOOL_BETA)).toHaveLength(1);
    }
  });

  it("overnight respects budget-exceeded before calling goalFn", async () => {
    const calls: number[] = [];
    let tmpDir: string | undefined;

    try {
      tmpDir = mkdtempSync(join(tmpdir(), "cmax-ce-budget-"));

      const mockGoalFn = async () => {
        calls.push(1);
        return finishedGoalResult();
      };

      await runOvernight(makeSpec(), {
        cwd: tmpDir,
        budgetCreditsUsd: 0, // immediately exceeded
        contextEngineering: true,
        goalFn: mockGoalFn as never,
      });

      // goalFn should never be called when budget is already exhausted
      expect(calls).toHaveLength(0);
    } finally {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
