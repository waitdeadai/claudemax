import { describe, expect, it } from "vitest";
import { deriveLanes, PLAN_LANE_CAP, probeHardware } from "../src/hardware.js";

function fakeHardware(overrides: Partial<ReturnType<typeof probeHardware>> = {}): ReturnType<
  typeof probeHardware
> {
  return {
    cores: 8,
    availableParallelism: 8,
    freeMemGB: 16,
    totalMemGB: 32,
    loadAvg1m: 1.0,
    thermallyConstrained: false,
    ...overrides,
  };
}

describe("deriveLanes", () => {
  it("explicit --max-parallel overrides everything", () => {
    const d = deriveLanes({ plan: "max20x", hardware: fakeHardware(), override: 2 });
    expect(d.lanes).toBe(2);
    expect(d.bottleneck).toBe("override");
  });

  it("floors by min(cores, ram, plan-cap)", () => {
    const d = deriveLanes({
      plan: "max20x",
      hardware: fakeHardware({ availableParallelism: 4, freeMemGB: 16 }),
    });
    expect(d.lanes).toBe(4);
    expect(d.bottleneck).toBe("cores");
  });

  it("ram bottleneck wins when free memory is low", () => {
    const d = deriveLanes({
      plan: "max20x",
      hardware: fakeHardware({ availableParallelism: 16, freeMemGB: 3 }),
    });
    expect(d.lanes).toBe(2);
    expect(d.bottleneck).toBe("ram");
  });

  it("plan cap wins when hardware is generous", () => {
    const d = deriveLanes({
      plan: "max5x",
      hardware: fakeHardware({ availableParallelism: 32, freeMemGB: 64 }),
    });
    expect(d.lanes).toBe(PLAN_LANE_CAP.max5x);
    expect(d.bottleneck).toBe("plan-cap");
  });

  it("halves under thermal back-pressure", () => {
    const d = deriveLanes({
      plan: "max20x",
      hardware: fakeHardware({ availableParallelism: 8, freeMemGB: 16, thermallyConstrained: true }),
    });
    expect(d.lanes).toBe(4);
    expect(d.bottleneck).toBe("thermal");
  });

  it("never returns lanes below 1", () => {
    const d = deriveLanes({
      plan: "pro",
      hardware: fakeHardware({ availableParallelism: 1, freeMemGB: 0.5 }),
    });
    expect(d.lanes).toBeGreaterThanOrEqual(1);
  });

  it("api plan opens the ceiling (sized only by hardware)", () => {
    const d = deriveLanes({
      plan: "api",
      hardware: fakeHardware({ availableParallelism: 8, freeMemGB: 16 }),
    });
    expect(d.lanes).toBe(8);
    expect(d.bottleneck).toBe("cores");
  });
});
