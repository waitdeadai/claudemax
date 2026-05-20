import { describe, expect, it } from "vitest";
import { computeParallelCap } from "../src/orchestrator.js";

describe("computeParallelCap", () => {
  it("hardware cap is reported", () => {
    const cap = computeParallelCap({});
    expect([3, 6, 10]).toContain(cap.hardware);
    expect(cap.effective).toBe(cap.hardware);
    expect(cap.creditAware).toBeNull();
  });

  it("override is respected (capped to hardware)", () => {
    const cap = computeParallelCap({ override: 4 });
    expect(cap.effective).toBeLessThanOrEqual(4);
    expect(cap.reason).toContain("override=4");
  });

  it("override above hardware is clamped to hardware", () => {
    const cap = computeParallelCap({ override: 1000 });
    expect(cap.effective).toBe(cap.hardware);
  });

  it("credit-aware cap = floor((remaining / per-packet) * 0.3)", () => {
    const cap = computeParallelCap({
      plan: "max20x",
      remainingCreditUsd: 100,
      perPacketCostEstimateUsd: 1,
    });
    expect(cap.creditAware).toBe(Math.floor(100 * 0.3));
  });

  it("effective is min(hardware, credit-aware)", () => {
    const cap = computeParallelCap({
      plan: "max5x",
      remainingCreditUsd: 4,
      perPacketCostEstimateUsd: 1,
    });
    expect(cap.creditAware).toBe(1);
    expect(cap.effective).toBe(1);
  });

  it("credit-aware floor never drops below 1", () => {
    const cap = computeParallelCap({
      plan: "max5x",
      remainingCreditUsd: 0,
      perPacketCostEstimateUsd: 1,
    });
    expect(cap.creditAware).toBe(1);
  });

  it("api mode does not compute credit-aware cap", () => {
    const cap = computeParallelCap({
      plan: "api",
      remainingCreditUsd: 100,
      perPacketCostEstimateUsd: 1,
    });
    expect(cap.creditAware).toBeNull();
  });
});
