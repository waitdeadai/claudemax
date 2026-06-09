import { describe, expect, it } from "vitest";
import { classifyHeuristic, route, type TaskSignal } from "../src/index.js";

function sig(over: Partial<TaskSignal> = {}): TaskSignal {
  return {
    class: "implement",
    complexity: 3,
    novelty: 3,
    summary: "implement a function",
    ...over,
  };
}

describe("router", () => {
  it("baselines plan to opus", () => {
    const d = route(sig({ class: "plan" }));
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(false);
  });

  it("baselines implement to sonnet", () => {
    const d = route(sig({ class: "implement", complexity: 3 }));
    expect(d.tier).toBe("sonnet");
  });

  it("escalates implement to opus when complexity ≥ 7", () => {
    const d = route(sig({ class: "implement", complexity: 8 }));
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(true);
  });

  it("escalates implement to opus on security domain", () => {
    const d = route(sig({ class: "implement", domain: "auth" }));
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(true);
  });

  it("forceCheap demotes opus to sonnet except verify/spec", () => {
    const dImpl = route(sig({ class: "plan" }), { forceCheap: true });
    expect(dImpl.tier).toBe("sonnet");
    const dVerify = route(sig({ class: "verify" }), { forceCheap: true });
    expect(dVerify.tier).toBe("opus");
  });

  it("respects explicit tier override", () => {
    const d = route(sig({ class: "search" }), { explicitTier: "opus" });
    expect(d.tier).toBe("opus");
  });

  it("escalates long-horizon plan/debug-hard to fable", () => {
    const dPlan = route(sig({ class: "plan", longHorizon: true }));
    expect(dPlan.tier).toBe("fable");
    expect(dPlan.model).toBe("claude-fable-5");
    expect(dPlan.escalated).toBe(true);
    const dDebug = route(sig({ class: "debug-hard", longHorizon: true }));
    expect(dDebug.tier).toBe("fable");
  });

  it("keeps verify/spec/architect pinned to opus even when long-horizon", () => {
    for (const cls of ["verify", "spec", "architect"] as const) {
      const d = route(sig({ class: cls, longHorizon: true }));
      expect(d.tier).toBe("opus");
    }
  });

  it("keeps security-domain long-horizon work on opus (fable classifier fallback)", () => {
    const d = route(sig({ class: "debug-hard", longHorizon: true, domain: "auth" }));
    expect(d.tier).toBe("opus");
  });

  it("does not escalate sonnet-baseline execution to fable", () => {
    const d = route(sig({ class: "implement", longHorizon: true }));
    expect(d.tier).toBe("sonnet");
  });

  it("respects explicit fable tier override", () => {
    const d = route(sig({ class: "implement" }), { explicitTier: "fable" });
    expect(d.tier).toBe("fable");
  });

  it("forceCheap demotes fable to sonnet", () => {
    const d = route(sig({ class: "plan", longHorizon: true }), { forceCheap: true });
    expect(d.tier).toBe("sonnet");
    expect(d.demoted).toBe(true);
  });

  it("plan-budget guard demotes fable one rung to opus", () => {
    const d = route(sig({ class: "plan", longHorizon: true }), {
      plan: "max20x",
      creditConsumedUsd: 150,
      era: "post-split",
    });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(true);
  });

  it("plan-budget danger demotes fable to sonnet", () => {
    const d = route(sig({ class: "plan", longHorizon: true }), {
      plan: "max20x",
      creditConsumedUsd: 185,
      era: "post-split",
    });
    expect(d.tier).toBe("sonnet");
  });

  it("cost-ceiling demotes fable to opus when opus fits", () => {
    const fableCost = route(sig({ class: "plan", longHorizon: true })).estimatedCostUsd;
    const d = route(sig({ class: "plan", longHorizon: true }), {
      costCeilingUsd: fableCost * 0.6,
    });
    expect(d.tier).toBe("opus");
  });

  it("classifies common summaries heuristically", () => {
    expect(classifyHeuristic("verify the spec is met")).toBe("verify");
    expect(classifyHeuristic("refactor the user module")).toBe("refactor");
    expect(classifyHeuristic("write tests for parser")).toBe("test");
    expect(classifyHeuristic("debug the flaky auth test")).toBe("debug-hard");
    expect(classifyHeuristic("write SPEC.md for migration")).toBe("spec");
  });
});
