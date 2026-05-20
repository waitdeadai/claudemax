import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baseSdkOptions,
  buildOtelEnv,
  estimateTaskBudgetTokens,
  parseUsageWithCache,
} from "../src/sdk-options.js";

describe("buildOtelEnv", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env["OTEL_RESOURCE_ATTRIBUTES"];
    delete process.env["OTEL_SERVICE_NAME"];
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("includes service name, version, and environment as resource attributes", () => {
    const env = buildOtelEnv({});
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("service.name=claudemax");
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("service.version=0.2.1");
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("deployment.environment=user-cli");
    expect(env["OTEL_SERVICE_NAME"]).toBe("claudemax");
  });

  it("adds agent_id and parent_agent_id when present", () => {
    const env = buildOtelEnv({ agentId: "abc-123", parentAgentId: "root-7" });
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("claudemax.agent_id=abc-123");
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("claudemax.parent_agent_id=root-7");
    expect(env["CLAUDE_CODE_AGENT_ID"]).toBe("abc-123");
    expect(env["CLAUDE_CODE_PARENT_AGENT_ID"]).toBe("root-7");
  });

  it("preserves an existing OTEL_RESOURCE_ATTRIBUTES prefix", () => {
    process.env["OTEL_RESOURCE_ATTRIBUTES"] = "deployment.tier=prod,team=infra";
    const env = buildOtelEnv({ agentId: "x" });
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toMatch(
      /^deployment\.tier=prod,team=infra,service\.name=claudemax/,
    );
  });

  it("does not override an already-set OTEL_SERVICE_NAME", () => {
    process.env["OTEL_SERVICE_NAME"] = "user-override";
    const env = buildOtelEnv({});
    expect(env["OTEL_SERVICE_NAME"]).toBeUndefined();
  });

  it("uses caller-supplied serviceVersion when provided", () => {
    const env = buildOtelEnv({ serviceVersion: "0.99.0" });
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("service.version=0.99.0");
  });
});

describe("baseSdkOptions", () => {
  it("merges OTEL env into the returned env block, caller env takes precedence", () => {
    const out = baseSdkOptions({ env: { CUSTOM: "1", OTEL_SERVICE_NAME: "custom" } });
    const env = out["env"] as Record<string, string>;
    expect(env["CUSTOM"]).toBe("1");
    expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toContain("service.name=claudemax");
    expect(env["OTEL_SERVICE_NAME"]).toBe("custom");
  });

  it("sets the default effort to xhigh when not specified", () => {
    const out = baseSdkOptions({});
    expect(out["effort"]).toBe("xhigh");
  });

  it("turns adaptive thinking into the SDK's thinking object", () => {
    const out = baseSdkOptions({ thinking: "adaptive" });
    expect(out["thinking"]).toEqual({ type: "adaptive" });
  });

  it("does not set thinking when 'off'", () => {
    const out = baseSdkOptions({ thinking: "off" });
    expect(out["thinking"]).toBeUndefined();
  });
});

describe("estimateTaskBudgetTokens", () => {
  it("respects the 20k minimum even for $0 budgets", () => {
    expect(estimateTaskBudgetTokens("opus", 0)).toBe(20_000);
    expect(estimateTaskBudgetTokens("sonnet", 0)).toBe(20_000);
  });

  it("scales token budget linearly with USD for opus", () => {
    const t1 = estimateTaskBudgetTokens("opus", 1);
    const t10 = estimateTaskBudgetTokens("opus", 10);
    expect(t10).toBeGreaterThan(t1 * 8);
    expect(t10).toBeLessThan(t1 * 12);
  });

  it("sonnet returns more tokens per dollar than opus (cheaper per token)", () => {
    expect(estimateTaskBudgetTokens("sonnet", 10)).toBeGreaterThan(
      estimateTaskBudgetTokens("opus", 10),
    );
  });

  it("haiku returns more tokens per dollar than sonnet", () => {
    expect(estimateTaskBudgetTokens("haiku", 10)).toBeGreaterThan(
      estimateTaskBudgetTokens("sonnet", 10),
    );
  });
});

describe("parseUsageWithCache", () => {
  it("returns zeros for empty or undefined usage", () => {
    expect(parseUsageWithCache(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    });
    expect(parseUsageWithCache({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    });
  });

  it("parses flat fields and nested cache_creation breakdown", () => {
    const r = parseUsageWithCache({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 800,
      cache_creation: {
        ephemeral_5m_input_tokens: 200,
        ephemeral_1h_input_tokens: 100,
      },
    });
    expect(r.inputTokens).toBe(1000);
    expect(r.outputTokens).toBe(500);
    expect(r.cacheReadTokens).toBe(800);
    expect(r.cacheWrite5mTokens).toBe(200);
    expect(r.cacheWrite1hTokens).toBe(100);
  });

  it("falls back to cache_creation_input_tokens when nested 5m field is absent", () => {
    const r = parseUsageWithCache({
      input_tokens: 1000,
      cache_creation_input_tokens: 300,
    });
    expect(r.cacheWrite5mTokens).toBe(300);
  });
});
