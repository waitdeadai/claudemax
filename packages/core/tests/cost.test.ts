import { describe, expect, it } from "vitest";
import {
  MONTHLY_CREDIT_USD,
  budgetTag,
  estimateCostUsd,
  estimatePacketCost,
  formatCost,
  formatPlanBudgetState,
} from "../src/index.js";

describe("cost — credit allocations", () => {
  it("Max 20x = $200, Max 5x = $100, Pro = $20, api = null", () => {
    expect(MONTHLY_CREDIT_USD.max20x).toBe(200);
    expect(MONTHLY_CREDIT_USD.max5x).toBe(100);
    expect(MONTHLY_CREDIT_USD.pro).toBe(20);
    expect(MONTHLY_CREDIT_USD.api).toBeNull();
  });
});

describe("cost — estimation", () => {
  it("estimatePacketCost is monotonically increasing in complexity for opus", () => {
    const c1 = estimatePacketCost("opus", 1);
    const c5 = estimatePacketCost("opus", 5);
    const c9 = estimatePacketCost("opus", 9);
    expect(c1).toBeLessThan(c5);
    expect(c5).toBeLessThan(c9);
  });

  it("opus > sonnet > haiku at equal complexity", () => {
    const o = estimatePacketCost("opus", 5);
    const s = estimatePacketCost("sonnet", 5);
    const h = estimatePacketCost("haiku", 5);
    expect(o).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(h);
  });

  it("estimateCostUsd discounts cached input tokens", () => {
    const full = estimateCostUsd("opus", { inputTokens: 100_000, outputTokens: 0 });
    const cached = estimateCostUsd("opus", {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 90_000,
    });
    expect(cached).toBeLessThan(full);
  });
});

describe("cost — formatting", () => {
  it("formatCost in api mode shows just dollars", () => {
    expect(formatCost(3.45, { plan: "api" })).toBe("$3.45");
    expect(formatCost(3.45)).toBe("$3.45");
  });

  it("formatCost in subscription mode shows dual format", () => {
    const out = formatCost(10, { plan: "max20x" });
    expect(out).toContain("$10");
    expect(out).toContain("% of $200");
    expect(out).toContain("5.0%");
  });

  it("formatCost in Max5x mode references $100 allocation", () => {
    const out = formatCost(10, { plan: "max5x" });
    expect(out).toContain("% of $100");
    expect(out).toContain("10.0%");
  });

  it("formatPlanBudgetState post-split: includes a tag bracket", () => {
    expect(formatPlanBudgetState("max20x", 50, "post-split")).toContain("[ok]");
    expect(formatPlanBudgetState("max20x", 145, "post-split")).toContain("[guard]");
    expect(formatPlanBudgetState("max20x", 185, "post-split")).toContain("[danger]");
    expect(formatPlanBudgetState("max20x", 195, "post-split")).toContain("[blocked]");
  });

  it("formatPlanBudgetState pre-split: explicitly flags the era and the forward-compat status", () => {
    const out = formatPlanBudgetState("max20x", 50, "pre-split");
    expect(out).toContain("pre-split");
    expect(out).toContain("2026-06-15");
    expect(out).toContain("FORWARD-COMPAT");
    expect(out).not.toContain("[ok]");
    expect(out).not.toContain("[guard]");
  });
});

describe("budgetTag — pre-split era is always ok regardless of consumption", () => {
  it("returns ok even at 95%+ because the credit envelope does not exist yet", () => {
    expect(budgetTag("max5x", 99, "pre-split")).toBe("ok");
    expect(budgetTag("max20x", 199, "pre-split")).toBe("ok");
    expect(budgetTag("pro", 19.5, "pre-split")).toBe("ok");
  });
});

describe("budgetTag — post-split: Max plans use identical thresholds, different absolute numbers", () => {
  const POST = "post-split" as const;

  it("api mode is always ok", () => {
    expect(budgetTag("api", 0, POST)).toBe("ok");
    expect(budgetTag("api", 9999, POST)).toBe("ok");
  });

  it("Max 20x: < $140 = ok, $140-180 = guard, $180-190 = danger, $190+ = blocked", () => {
    expect(budgetTag("max20x", 100, POST)).toBe("ok");
    expect(budgetTag("max20x", 139.99, POST)).toBe("ok");
    expect(budgetTag("max20x", 140, POST)).toBe("guard");
    expect(budgetTag("max20x", 179.99, POST)).toBe("guard");
    expect(budgetTag("max20x", 180, POST)).toBe("danger");
    expect(budgetTag("max20x", 189.99, POST)).toBe("danger");
    expect(budgetTag("max20x", 190, POST)).toBe("blocked");
  });

  it("Max 5x: < $70 = ok, $70-90 = guard, $90-95 = danger, $95+ = blocked", () => {
    expect(budgetTag("max5x", 50, POST)).toBe("ok");
    expect(budgetTag("max5x", 69.99, POST)).toBe("ok");
    expect(budgetTag("max5x", 70, POST)).toBe("guard");
    expect(budgetTag("max5x", 89.99, POST)).toBe("guard");
    expect(budgetTag("max5x", 90, POST)).toBe("danger");
    expect(budgetTag("max5x", 94.99, POST)).toBe("danger");
    expect(budgetTag("max5x", 95, POST)).toBe("blocked");
  });

  it("Pro: thresholds scale proportionally", () => {
    expect(budgetTag("pro", 10, POST)).toBe("ok");
    expect(budgetTag("pro", 14, POST)).toBe("guard");
    expect(budgetTag("pro", 18, POST)).toBe("danger");
    expect(budgetTag("pro", 19.5, POST)).toBe("blocked");
  });
});
