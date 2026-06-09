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
  it("baselines plan to fable while fable is included", () => {
    const d = route(sig({ class: "plan" }), { fableAccess: "included" });
    expect(d.tier).toBe("fable");
    expect(d.model).toBe("claude-fable-5");
    expect(d.escalated).toBe(false);
  });

  it("demotes plan baseline to opus when fable bills usage credits", () => {
    const d = route(sig({ class: "plan" }), { fableAccess: "credits" });
    expect(d.tier).toBe("opus");
    expect(d.reasoning).toContain("fable-access=credits");
  });

  it("disables long-horizon fable escalation in credits mode", () => {
    const d = route(sig({ class: "debug-hard", longHorizon: true }), {
      fableAccess: "credits",
    });
    expect(d.tier).toBe("opus");
  });

  it("still honors explicit fable tier in credits mode", () => {
    const d = route(sig({ class: "implement" }), {
      explicitTier: "fable",
      fableAccess: "credits",
    });
    expect(d.tier).toBe("fable");
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
    const dImpl = route(sig({ class: "plan" }), { forceCheap: true, fableAccess: "credits" });
    expect(dImpl.tier).toBe("sonnet");
    const dVerify = route(sig({ class: "verify" }), { forceCheap: true });
    expect(dVerify.tier).toBe("opus");
  });

  it("respects explicit tier override", () => {
    const d = route(sig({ class: "search" }), { explicitTier: "opus" });
    expect(d.tier).toBe("opus");
  });

  it("escalates long-horizon debug-hard to fable while included", () => {
    const d = route(sig({ class: "debug-hard", longHorizon: true }), {
      fableAccess: "included",
    });
    expect(d.tier).toBe("fable");
    expect(d.escalated).toBe(true);
  });

  it("keeps verify/spec/architect pinned to opus even when long-horizon", () => {
    for (const cls of ["verify", "spec", "architect"] as const) {
      const d = route(sig({ class: cls, longHorizon: true }), { fableAccess: "included" });
      expect(d.tier).toBe("opus");
    }
  });

  it("clamps security-domain fable work to opus (classifier fallback)", () => {
    const dDebug = route(sig({ class: "debug-hard", longHorizon: true, domain: "auth" }), {
      fableAccess: "included",
    });
    expect(dDebug.tier).toBe("opus");
    const dPlan = route(sig({ class: "plan", domain: "payments" }), {
      fableAccess: "included",
    });
    expect(dPlan.tier).toBe("opus");
  });

  it("does not escalate sonnet-baseline execution to fable", () => {
    const d = route(sig({ class: "implement", longHorizon: true }), {
      fableAccess: "included",
    });
    expect(d.tier).toBe("sonnet");
  });

  it("respects explicit fable tier override", () => {
    const d = route(sig({ class: "implement" }), {
      explicitTier: "fable",
      fableAccess: "included",
    });
    expect(d.tier).toBe("fable");
  });

  it("forceCheap demotes fable to sonnet", () => {
    const d = route(sig({ class: "plan" }), { forceCheap: true, fableAccess: "included" });
    expect(d.tier).toBe("sonnet");
    expect(d.demoted).toBe(true);
  });

  it("plan-budget guard demotes fable one rung to opus", () => {
    const d = route(sig({ class: "plan" }), {
      plan: "max20x",
      creditConsumedUsd: 150,
      era: "post-split",
      fableAccess: "included",
    });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(true);
  });

  it("plan-budget danger demotes fable to sonnet", () => {
    const d = route(sig({ class: "plan" }), {
      plan: "max20x",
      creditConsumedUsd: 185,
      era: "post-split",
      fableAccess: "included",
    });
    expect(d.tier).toBe("sonnet");
  });

  it("cost-ceiling demotes fable to opus when opus fits", () => {
    const fableCost = route(sig({ class: "plan" }), { fableAccess: "included" }).estimatedCostUsd;
    const d = route(sig({ class: "plan" }), {
      costCeilingUsd: fableCost * 0.6,
      fableAccess: "included",
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
