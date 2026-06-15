import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spec, VerificationReport } from "@claudemax/core";
import type { GoalRunResult } from "../src/goal.js";
import { CE_PROTECTED_TOOLS, type LoopContextEngineeringOpts } from "../src/context-engineering.js";
import { runConvergeLoop } from "../src/loop.js";

// detectPlan() (via the fleet budget guard) must not shell out to `claude` in tests.
beforeEach(() => {
  process.env["CMAX_SKIP_CLI_PROBE"] = "1";
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["CMAX_PLAN"];
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cmax-ce-loop-"));
}

function spec(conditions = 1): Spec {
  return {
    title: "CE Loop Test",
    goal: "test context engineering threading",
    nonGoals: [],
    constraints: [],
    completionConditions: Array.from({ length: conditions }, (_, i) => ({
      id: `cc-${i + 1}`,
      description: `condition ${i + 1}`,
      verifyHint: "test",
    })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-06-15T00:00:00Z",
  };
}

function goalResult(over: Partial<GoalRunResult> = {}): GoalRunResult {
  return {
    status: "finished",
    summary: "done",
    evidence: {},
    turns: 1,
    tokensIn: 100,
    tokensOut: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  };
}

function report(
  s: Spec,
  verdict: VerificationReport["verdict"],
  metIds: string[],
): VerificationReport {
  return {
    spec: s,
    perCondition: s.completionConditions.map((cc) => ({
      id: cc.id,
      met: metIds.includes(cc.id),
      evidence: metIds.includes(cc.id) ? "verified by test" : "",
      confidence: 0.95,
    })),
    suppressedLowConfidence: [],
    verdict,
    verifierTier: "opus",
    notes: "",
    confidenceThreshold: 0.8,
  };
}

// [s4b-cc1] OFF by default — default loop options are unchanged
describe("default (no contextEngineering opt-in)", () => {
  it("iterate receives undefined ceOpts when contextEngineering is not set", async () => {
    const s = spec(1);
    const capturedCeArgs: Array<LoopContextEngineeringOpts | undefined> = [];

    await runConvergeLoop(s, {
      cwd: tmp(),
      iterateFn: async (_spec, _rem, ceOpts) => {
        capturedCeArgs.push(ceOpts);
        return goalResult();
      },
      verifyFn: async () => report(s, "verified", ["cc-1"]),
    });

    expect(capturedCeArgs.length).toBeGreaterThan(0);
    for (const ce of capturedCeArgs) {
      expect(ce).toBeUndefined();
    }
  });

  it("iterate receives undefined ceOpts when contextEngineering is explicitly false", async () => {
    const s = spec(1);
    const capturedCeArgs: Array<LoopContextEngineeringOpts | undefined> = [];

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: false,
      iterateFn: async (_spec, _rem, ceOpts) => {
        capturedCeArgs.push(ceOpts);
        return goalResult();
      },
      verifyFn: async () => report(s, "verified", ["cc-1"]),
    });

    for (const ce of capturedCeArgs) {
      expect(ce).toBeUndefined();
    }
  });

  it("loop converges identically whether contextEngineering is absent or false", async () => {
    const s = spec(1);

    const [r1, r2] = await Promise.all([
      runConvergeLoop(s, {
        cwd: tmp(),
        iterateFn: async () => goalResult(),
        verifyFn: async () => report(s, "verified", ["cc-1"]),
      }),
      runConvergeLoop(s, {
        cwd: tmp(),
        contextEngineering: false,
        iterateFn: async () => goalResult(),
        verifyFn: async () => report(s, "verified", ["cc-1"]),
      }),
    ]);

    expect(r1.finalAction).toBe("done");
    expect(r2.finalAction).toBe("done");
    expect(r1.passes.length).toBe(r2.passes.length);
  });
});

// [s4b-cc2] verify-never-enabled — verify is always excluded
describe("verify-never-enabled", () => {
  it("verifyFn is called with only spec (no ceOpts) even when contextEngineering:true", async () => {
    const s = spec(1);
    let verifyCallArgCount = -1;
    let verifySecondArg: unknown = "sentinel-unchanged";

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      iterateFn: async () => goalResult(),
      verifyFn: async (...args) => {
        verifyCallArgCount = args.length;
        verifySecondArg = args[1];
        return report(s, "verified", ["cc-1"]);
      },
    });

    // verifyFn was called exactly once (loop converges after 1 pass)
    expect(verifyCallArgCount).toBe(1);
    // Only the spec was passed — no ceOpts arg
    expect(verifySecondArg).toBeUndefined();
  });

  it("verifyFn arg-count is always 1 across multiple passes", async () => {
    const s = spec(1);
    let pass = 0;
    const verifyCounts: number[] = [];

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      maxPasses: 3,
      respecAfterStuck: 99,
      iterateFn: async () => goalResult(),
      verifyFn: async (...args) => {
        verifyCounts.push(args.length);
        pass++;
        return pass >= 2
          ? report(s, "verified", ["cc-1"])
          : report(s, "failed", []);
      },
    });

    // Every call: exactly 1 arg (only spec)
    expect(verifyCounts.every((n) => n === 1)).toBe(true);
  });
});

// [s4b-cc3] enabled-iterate-carries-protection
describe("enabled iterate carries protected exclusion", () => {
  it("iterateFn receives ceOpts with protectedTools containing all grounding tools when contextEngineering:true", async () => {
    const s = spec(1);
    let capturedCeOpts: LoopContextEngineeringOpts | undefined;

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      iterateFn: async (_spec, _rem, ceOpts) => {
        capturedCeOpts = ceOpts;
        return goalResult();
      },
      verifyFn: async () => report(s, "verified", ["cc-1"]),
    });

    expect(capturedCeOpts).toBeDefined();
    // protectedTools must include all four grounding tools
    expect(capturedCeOpts?.protectedTools).toContain("mcp__memory__memory_search");
    expect(capturedCeOpts?.protectedTools).toContain("mcp__memory__memory_get_decision");
    expect(capturedCeOpts?.protectedTools).toContain("mcp__memory__memory_get_fact");
    expect(capturedCeOpts?.protectedTools).toContain("mcp__memory__memory_stale");
    // protectedTools matches CE_PROTECTED_TOOLS exactly
    expect(capturedCeOpts?.protectedTools).toEqual(CE_PROTECTED_TOOLS);
    // memoryPath is a non-empty string pointing to the per-run state dir
    expect(typeof capturedCeOpts?.memoryPath).toBe("string");
    expect(capturedCeOpts!.memoryPath.length).toBeGreaterThan(0);
  });

  it("all iterate calls receive the same ceOpts across multiple passes", async () => {
    const s = spec(1);
    const ceArgCaptures: Array<LoopContextEngineeringOpts | undefined> = [];
    let pass = 0;

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      maxPasses: 3,
      respecAfterStuck: 99,
      iterateFn: async (_spec, _rem, ceOpts) => {
        ceArgCaptures.push(ceOpts);
        return goalResult();
      },
      verifyFn: async () => {
        pass++;
        return pass >= 2
          ? report(s, "verified", ["cc-1"])
          : report(s, "failed", []);
      },
    });

    expect(ceArgCaptures.length).toBeGreaterThan(1);
    for (const ce of ceArgCaptures) {
      expect(ce).toBeDefined();
      expect(ce?.protectedTools).toContain("mcp__memory__memory_search");
    }
    // Same memoryPath across all passes (per-run isolation, not per-pass)
    const paths = ceArgCaptures.map((c) => c?.memoryPath);
    expect(new Set(paths).size).toBe(1);
  });

  it("iterate ceOpts is defined while verifyFn arg-count stays 1 in the same run", async () => {
    const s = spec(1);
    let capturedCeOpts: LoopContextEngineeringOpts | undefined;
    let verifyArgCount = -1;

    await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      iterateFn: async (_spec, _rem, ceOpts) => {
        capturedCeOpts = ceOpts;
        return goalResult();
      },
      verifyFn: async (...args) => {
        verifyArgCount = args.length;
        return report(s, "verified", ["cc-1"]);
      },
    });

    // iterate received ceOpts
    expect(capturedCeOpts).toBeDefined();
    // verify did NOT receive ceOpts (only spec)
    expect(verifyArgCount).toBe(1);
  });
});

// [prc-error-handling] Graceful failure paths
describe("error handling", () => {
  it("error in iterateFn propagates without being swallowed", async () => {
    const s = spec(1);

    await expect(
      runConvergeLoop(s, {
        cwd: tmp(),
        contextEngineering: true,
        iterateFn: async () => {
          throw new Error("simulated iterate failure");
        },
        verifyFn: async () => report(s, "verified", ["cc-1"]),
      }),
    ).rejects.toThrow("simulated iterate failure");
  });

  it("error in verifyFn propagates without being swallowed", async () => {
    const s = spec(1);

    await expect(
      runConvergeLoop(s, {
        cwd: tmp(),
        contextEngineering: true,
        iterateFn: async () => goalResult(),
        verifyFn: async () => {
          throw new Error("simulated verify failure");
        },
      }),
    ).rejects.toThrow("simulated verify failure");
  });

  it("contextEngineering:true with blocked iterate still surfaces blocked finalAction", async () => {
    const s = spec(1);

    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      iterateFn: async () => goalResult({ status: "blocked", summary: "missing creds" }),
      verifyFn: async () => report(s, "failed", []),
    });

    expect(res.finalAction).toBe("blocked");
  });
});

// [prc-edge-cases] Boundary / edge cases
describe("edge cases", () => {
  it("zero completionConditions with contextEngineering:true — loop exits and ceOpts is defined", async () => {
    const s = spec(0);
    let capturedCeOpts: LoopContextEngineeringOpts | undefined;

    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      iterateFn: async (_spec, _rem, ceOpts) => {
        capturedCeOpts = ceOpts;
        return goalResult();
      },
      verifyFn: async () => ({
        ...report(s, "verified", []),
        perCondition: [],
      }),
    });

    // Loop must exit (verified or stop), not hang
    expect(["done", "stop-max", "blocked"]).toContain(res.finalAction);
    // ceOpts was defined even with zero conditions
    expect(capturedCeOpts).toBeDefined();
  });

  it("maxPasses:1 with contextEngineering:true hits ceiling correctly", async () => {
    const s = spec(1);

    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      contextEngineering: true,
      maxPasses: 1,
      respecAfterStuck: 99,
      iterateFn: async () => goalResult(),
      verifyFn: async () => report(s, "partial", []),
    });

    expect(res.finalAction).toBe("stop-max");
    expect(res.passes.length).toBe(1);
  });

  it("CE_PROTECTED_TOOLS is a non-empty array containing all four grounding tools", () => {
    expect(Array.isArray(CE_PROTECTED_TOOLS)).toBe(true);
    expect(CE_PROTECTED_TOOLS.length).toBeGreaterThan(0);
    expect(CE_PROTECTED_TOOLS).toContain("mcp__memory__memory_search");
    expect(CE_PROTECTED_TOOLS).toContain("mcp__memory__memory_get_decision");
    expect(CE_PROTECTED_TOOLS).toContain("mcp__memory__memory_get_fact");
    expect(CE_PROTECTED_TOOLS).toContain("mcp__memory__memory_stale");
  });

  it("ceOpts.protectedTools is a fresh array instance each run (no shared mutation)", async () => {
    const s = spec(1);
    const ceLots: LoopContextEngineeringOpts[] = [];

    for (let i = 0; i < 2; i++) {
      await runConvergeLoop(s, {
        cwd: tmp(),
        contextEngineering: true,
        iterateFn: async (_s, _r, ce) => {
          if (ce) ceLots.push(ce);
          return goalResult();
        },
        verifyFn: async () => report(s, "verified", ["cc-1"]),
      });
    }

    expect(ceLots.length).toBe(2);
    // Mutating one should not affect the other
    (ceLots[0]!.protectedTools as string[]).push?.("injected");
    expect(ceLots[1]!.protectedTools).not.toContain("injected");
  });
});
