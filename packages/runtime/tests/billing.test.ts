import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPlan, describePlan } from "../src/billing.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env["CMAX_PLAN"];
  delete process.env["ANTHROPIC_API_KEY"];
  process.env["CMAX_SKIP_CLI_PROBE"] = "1";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("detectPlan", () => {
  it("CMAX_PLAN=max20x wins over everything", () => {
    process.env["CMAX_PLAN"] = "max20x";
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    const info = detectPlan();
    expect(info.plan).toBe("max20x");
    expect(info.billing).toBe("subscription");
    expect(info.monthlyCreditUsd).toBe(200);
    expect(info.source).toBe("env");
  });

  it("CMAX_PLAN=max5x sets credit to $100", () => {
    process.env["CMAX_PLAN"] = "max5x";
    const info = detectPlan();
    expect(info.plan).toBe("max5x");
    expect(info.monthlyCreditUsd).toBe(100);
    expect(info.source).toBe("env");
  });

  it("CMAX_PLAN=pro sets credit to $20", () => {
    process.env["CMAX_PLAN"] = "pro";
    const info = detectPlan();
    expect(info.plan).toBe("pro");
    expect(info.monthlyCreditUsd).toBe(20);
  });

  it("CMAX_PLAN=api sets billing to api and credit to null", () => {
    process.env["CMAX_PLAN"] = "api";
    const info = detectPlan();
    expect(info.plan).toBe("api");
    expect(info.billing).toBe("api");
    expect(info.monthlyCreditUsd).toBeNull();
  });

  it("ANTHROPIC_API_KEY without CMAX_PLAN routes to api auto-detect", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    const info = detectPlan();
    expect(info.plan).toBe("api");
    expect(info.billing).toBe("api");
    expect(info.source).toBe("auto-detect");
  });

  it("no env vars falls through to default max5x", () => {
    const info = detectPlan();
    expect(["max5x", "max20x", "pro"]).toContain(info.plan);
    expect(["default", "auto-detect"]).toContain(info.source);
  });

  it("invalid CMAX_PLAN does not crash (falls through to auto-detect path)", () => {
    process.env["CMAX_PLAN"] = "not-a-plan";
    const info = detectPlan();
    expect(info.plan).toBeTruthy();
    expect(info.source).not.toBe("env");
  });
});

describe("describePlan", () => {
  it("subscription mode describes the credit allocation", () => {
    const txt = describePlan({
      plan: "max20x",
      billing: "subscription",
      monthlyCreditUsd: 200,
      source: "env",
    });
    expect(txt).toContain("subscription");
    expect(txt).toContain("$200");
    expect(txt).toContain("max20x");
  });

  it("api mode names the API key auth path", () => {
    const txt = describePlan({
      plan: "api",
      billing: "api",
      monthlyCreditUsd: null,
      source: "auto-detect",
    });
    expect(txt).toContain("api");
    expect(txt).toContain("ANTHROPIC_API_KEY");
  });
});
