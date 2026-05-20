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

  it("classifies common summaries heuristically", () => {
    expect(classifyHeuristic("verify the spec is met")).toBe("verify");
    expect(classifyHeuristic("refactor the user module")).toBe("refactor");
    expect(classifyHeuristic("write tests for parser")).toBe("test");
    expect(classifyHeuristic("debug the flaky auth test")).toBe("debug-hard");
    expect(classifyHeuristic("write SPEC.md for migration")).toBe("spec");
  });
});
