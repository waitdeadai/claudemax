import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workItemKey, type Spec, type VerificationReport } from "@claudemax/core";
import { runConvergeLoop } from "./loop.js";
import type { GoalRunResult } from "./goal.js";
import {
  runStandingLoopTick,
  saveStandingLoopSpec,
  setStandingLoopStatus,
  loadLedger,
  type StandingLoopSpec,
  type StandingLoopDeps,
  type DecidedItem,
  type SensedItem,
} from "./index.js";

// detectPlan() (via the fleet budget guard) must not shell out to `claude` in tests.
beforeEach(() => {
  process.env["CMAX_SKIP_CLI_PROBE"] = "1";
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["CMAX_PLAN"];
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cmax-loop-"));
}

function spec(conditions = 1): Spec {
  return {
    title: "Test Loop Spec",
    goal: "do the thing",
    nonGoals: [],
    constraints: [],
    completionConditions: Array.from({ length: conditions }, (_, i) => ({
      id: `cc-${i + 1}`,
      description: `condition ${i + 1}`,
      verifyHint: "test",
    })),
    assumptions: [],
    evidenceRequired: [],
    createdAt: "2026-06-08T00:00:00Z",
  };
}

function goalResult(over: Partial<GoalRunResult> = {}): GoalRunResult {
  return {
    status: "finished",
    summary: "did work",
    evidence: {},
    turns: 3,
    tokensIn: 1000,
    tokensOut: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  };
}

function report(s: Spec, verdict: VerificationReport["verdict"], metIds: string[]): VerificationReport {
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

describe("runConvergeLoop (Archetype A)", () => {
  it("drives to done when verify goes green", async () => {
    const s = spec(1);
    let pass = 0;
    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      iterateFn: async () => goalResult(),
      verifyFn: async () => {
        pass++;
        return pass >= 2 ? report(s, "verified", ["cc-1"]) : report(s, "failed", []);
      },
    });
    expect(res.finalAction).toBe("done");
    expect(res.passes.length).toBe(2);
    expect(res.lastReport?.verdict).toBe("verified");
  });

  it("stops on a hard blocker from the advance", async () => {
    const s = spec(1);
    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      iterateFn: async () => goalResult({ status: "blocked", summary: "missing creds" }),
      verifyFn: async () => report(s, "failed", []),
    });
    expect(res.finalAction).toBe("blocked");
    expect(res.passes.length).toBe(1);
  });

  it("respecs after stalling, then can converge on the new spec", async () => {
    const s = spec(2);
    let respecs = 0;
    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      maxPasses: 20,
      respecAfterStuck: 2,
      iterateFn: async () => goalResult(),
      // Always stuck on the original spec; the respec'd spec converges.
      verifyFn: async (cur) =>
        cur.title.startsWith("RESPEC")
          ? report(cur, "verified", cur.completionConditions.map((c) => c.id))
          : report(cur, "partial", ["cc-1"]),
      respecFn: async (cur) => {
        respecs++;
        return { ...cur, title: `RESPEC ${cur.title}` };
      },
    });
    expect(respecs).toBe(1);
    expect(res.finalAction).toBe("done");
  });

  it("stops on the pass ceiling", async () => {
    const s = spec(2);
    const res = await runConvergeLoop(s, {
      cwd: tmp(),
      maxPasses: 3,
      respecAfterStuck: 99, // disable respec so the ceiling is what trips
      iterateFn: async () => goalResult(),
      verifyFn: async () => report(s, "partial", ["cc-1"]),
    });
    expect(res.finalAction).toBe("stop-max");
    expect(res.passes.length).toBe(3);
  });
});

describe("runStandingLoopTick (Archetype B)", () => {
  function fakeDeps(over: Partial<StandingLoopDeps> = {}): {
    deps: StandingLoopDeps;
    actCalls: string[];
  } {
    const actCalls: string[] = [];
    const sensed: SensedItem[] = [
      { id: "1", source: "shell", title: "item one", body: "b1" },
      { id: "2", source: "shell", title: "item two", body: "b2" },
    ];
    const deps: StandingLoopDeps = {
      sense: async () => sensed,
      triage: async (): Promise<DecidedItem[]> =>
        sensed.map((s) => ({
          key: workItemKey(s.source, s.id),
          title: s.title,
          source: s.source,
          goal: `handle ${s.title}`,
        })),
      act: async (item) => {
        actCalls.push(item.title);
        return {
          finalAction: "done",
          passes: [],
          spec: spec(1),
          lastReport: report(spec(1), "verified", ["cc-1"]),
          totalCreditUsd: 1,
          respecs: 0,
        };
      },
      report: async () => {},
      ...over,
    };
    return { deps, actCalls };
  }

  function standing(over: Partial<StandingLoopSpec> = {}): StandingLoopSpec {
    return {
      name: "test-loop",
      intent: "watch and act",
      schedule: "*/15 * * * *",
      sources: [{ kind: "shell", command: "true" }],
      maxItemsPerTick: 5,
      maxCreditUsdPerTick: 100,
      perItemCreditUsd: 10,
      createdAt: "2026-06-08T00:00:00Z",
      ...over,
    };
  }

  it("acts on fresh items and ledgers them", async () => {
    const cwd = tmp();
    const { deps, actCalls } = fakeDeps();
    const out = await runStandingLoopTick(standing(), deps, { cwd, now: "2026-06-08T01:00:00Z" });
    expect(out.acted.length).toBe(2);
    expect(actCalls).toEqual(["item one", "item two"]);
    expect(loadLedger(cwd, "test-loop").entries.length).toBe(2);
  });

  it("dedups already-done items on the next tick", async () => {
    const cwd = tmp();
    const { deps } = fakeDeps();
    await runStandingLoopTick(standing(), deps, { cwd, now: "2026-06-08T01:00:00Z" });
    const out2 = await runStandingLoopTick(standing(), deps, { cwd, now: "2026-06-08T01:15:00Z" });
    expect(out2.acted.length).toBe(0);
    expect(out2.skippedAlreadyDone).toBe(2);
  });

  it("respects the per-tick credit cap", async () => {
    const cwd = tmp();
    const { deps, actCalls } = fakeDeps();
    const out = await runStandingLoopTick(standing({ maxCreditUsdPerTick: 1 }), deps, {
      cwd,
      now: "2026-06-08T01:00:00Z",
    });
    expect(out.budgetStopped).toBe(true);
    expect(actCalls.length).toBe(1);
  });

  it("no-ops when paused", async () => {
    const cwd = tmp();
    const { deps, actCalls } = fakeDeps();
    saveStandingLoopSpec(cwd, standing());
    expect(setStandingLoopStatus(cwd, "test-loop", "paused")).toBe(true);
    const out = await runStandingLoopTick(standing(), deps, { cwd, now: "2026-06-08T01:00:00Z" });
    expect(out.paused).toBe(true);
    expect(actCalls.length).toBe(0);
  });

  it("caps the number of items considered per tick", async () => {
    const cwd = tmp();
    const { deps, actCalls } = fakeDeps();
    const out = await runStandingLoopTick(standing({ maxItemsPerTick: 1 }), deps, {
      cwd,
      now: "2026-06-08T01:00:00Z",
    });
    expect(out.considered).toBe(1);
    expect(actCalls.length).toBe(1);
  });
});
