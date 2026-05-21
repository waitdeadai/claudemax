import { describe, expect, it } from "vitest";
import { route, type TaskSignal } from "../src/index.js";

function sig(over: Partial<TaskSignal> = {}): TaskSignal {
  return {
    class: "implement",
    complexity: 3,
    novelty: 3,
    summary: "implement a function",
    ...over,
  };
}

describe("router — plan-aware cost guard (post-split era)", () => {
  // The plan-budget demote path only exists in the post-split era. Tests pin
  // era explicitly so they remain valid both today (pre-split) and after
  // 2026-06-15 when the harness auto-resolves to post-split.
  const POST = { era: "post-split" as const };

  it("ok zone (<70%) does not demote", () => {
    const d = route(sig({ class: "plan" }), { plan: "max5x", creditConsumedUsd: 30, ...POST });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(false);
  });

  it("guard zone (70-90%) demotes Opus to Sonnet for non-NEVER_DEMOTE classes", () => {
    const d = route(sig({ class: "plan" }), { plan: "max5x", creditConsumedUsd: 75, ...POST });
    expect(d.tier).toBe("sonnet");
    expect(d.demoted).toBe(true);
    expect(d.reasoning).toContain("plan-budget");
  });

  it("danger zone (90-95%) demotes aggressively", () => {
    const d = route(sig({ class: "plan" }), { plan: "max5x", creditConsumedUsd: 92, ...POST });
    expect(d.tier).toBe("sonnet");
    expect(d.demoted).toBe(true);
    expect(d.reasoning).toContain("danger");
  });

  it("verify NEVER demotes even at 95%+", () => {
    const d = route(sig({ class: "verify" }), { plan: "max5x", creditConsumedUsd: 99, ...POST });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(false);
  });

  it("spec NEVER demotes even at 95%+", () => {
    const d = route(sig({ class: "spec" }), { plan: "max5x", creditConsumedUsd: 99, ...POST });
    expect(d.tier).toBe("opus");
  });

  it("architect NEVER demotes even at 95%+", () => {
    const d = route(sig({ class: "architect" }), { plan: "max5x", creditConsumedUsd: 99, ...POST });
    expect(d.tier).toBe("opus");
  });

  it("Max 20x has same behavior at proportionally-scaled thresholds", () => {
    const okZone = route(sig({ class: "plan" }), { plan: "max20x", creditConsumedUsd: 100, ...POST });
    expect(okZone.tier).toBe("opus");

    const guardZone = route(sig({ class: "plan" }), { plan: "max20x", creditConsumedUsd: 150, ...POST });
    expect(guardZone.tier).toBe("sonnet");
    expect(guardZone.demoted).toBe(true);
  });

  it("api mode (no credit) never triggers plan-budget demote", () => {
    const d = route(sig({ class: "plan" }), { plan: "api", creditConsumedUsd: 99999, ...POST });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(false);
  });
});

describe("router — pre-split era (today, until 2026-06-15)", () => {
  it("never demotes on credit envelope because the monthly Agent SDK credit does not exist yet", () => {
    const d = route(sig({ class: "plan" }), {
      plan: "max5x",
      creditConsumedUsd: 99,
      era: "pre-split",
    });
    expect(d.tier).toBe("opus");
    expect(d.demoted).toBe(false);
  });

  it("escalation still works in pre-split era (complexity=8 → opus)", () => {
    const d = route(sig({ complexity: 8, class: "implement" }), {
      plan: "max5x",
      creditConsumedUsd: 92,
      era: "pre-split",
    });
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(true);
    expect(d.demoted).toBe(false);
  });
});

describe("router — escalation interplay with plan-budget", () => {
  it("escalation to Opus + danger budget = back to Sonnet (escalated and demoted both true) [post-split]", () => {
    const d = route(sig({ complexity: 8, class: "implement" }), {
      plan: "max5x",
      creditConsumedUsd: 92,
      era: "post-split",
    });
    expect(d.tier).toBe("sonnet");
    expect(d.escalated).toBe(true);
    expect(d.demoted).toBe(true);
    expect(d.reasoning).toContain("complexity=8");
    expect(d.reasoning).toContain("danger");
  });
});

describe("router — security domain stays Opus regardless", () => {
  it("auth domain on implement always opus", () => {
    const d = route(sig({ class: "implement", domain: "auth" }));
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(true);
  });

  it("payments domain on test escalates to opus", () => {
    const d = route(sig({ class: "test", domain: "payments" }));
    expect(d.tier).toBe("opus");
    expect(d.escalated).toBe(true);
  });
});

describe("router — cost-ceiling", () => {
  it("opus exceeding ceiling demotes to sonnet when sonnet fits", () => {
    const d = route(sig({ class: "plan", complexity: 6 }), { costCeilingUsd: 0.3 });
    expect(d.tier).toBe("sonnet");
    expect(d.demoted).toBe(true);
    expect(d.reasoning).toContain("cost-ceiling");
  });

  it("ceiling does not demote verify", () => {
    const d = route(sig({ class: "verify", complexity: 6 }), { costCeilingUsd: 0.1 });
    expect(d.tier).toBe("opus");
  });
});
