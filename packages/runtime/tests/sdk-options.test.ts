import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baseSdkOptions,
  buildOtelEnv,
  estimateTaskBudgetTokens,
  parseUsageWithCache,
  TASK_BUDGET_BETA,
} from "../src/sdk-options.js";
import {
  buildContextEditingConfig,
  buildMemoryToolConfig,
  MEMORY_TOOL_BETA,
} from "../src/context-engineering.js";

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

describe("baseSdkOptions settingSources (goal Stop-hook deadlock fix)", () => {
  it("defaults to user + project settings", () => {
    expect(baseSdkOptions({})["settingSources"]).toEqual(["user", "project"]);
  });

  it("honors an explicit override so the /goal driver can run with no file hooks", () => {
    expect(baseSdkOptions({ settingSources: [] })["settingSources"]).toEqual([]);
  });
});

describe("baseSdkOptions env (sub-session Bash PATH fix)", () => {
  it("inherits the parent PATH so Bash tool subprocesses can find git/ls/node/pnpm", () => {
    const env = baseSdkOptions({}).env as Record<string, string | undefined>;
    expect(env["PATH"]).toBe(process.env["PATH"]);
  });

  it("overlays caller env on top of the inherited environment without dropping PATH", () => {
    const env = baseSdkOptions({ env: { CMAX_TEST_OVERLAY: "yes" } }).env as Record<
      string,
      string | undefined
    >;
    expect(env["CMAX_TEST_OVERLAY"]).toBe("yes");
    expect(env["PATH"]).toBe(process.env["PATH"]);
  });
});

// [s3-cc1] Context editing + memory tool: OFF by default
describe("baseSdkOptions context-engineering: OFF by default", () => {
  it("produces no context_management key when contextEditing is absent", () => {
    expect(baseSdkOptions({})["context_management"]).toBeUndefined();
  });

  it("produces no context_management key when contextEditing is false", () => {
    expect(baseSdkOptions({ contextEditing: false })["context_management"]).toBeUndefined();
  });

  it("does not add memory_20250818 beta when memoryTool is absent", () => {
    const betas = baseSdkOptions({})["betas"] as string[] | undefined;
    expect(betas).toBeUndefined();
  });

  it("does not add memory_20250818 beta when memoryTool is false", () => {
    const betas = baseSdkOptions({ memoryTool: false })["betas"] as string[] | undefined;
    expect(betas).toBeUndefined();
  });

  it("output is byte-identical to previous behavior when no new flags are set", () => {
    const out = baseSdkOptions({});
    expect(out["context_management"]).toBeUndefined();
    expect(out["betas"]).toBeUndefined();
    // existing defaults still present
    expect(out["effort"]).toBe("xhigh");
    expect(out["skills"]).toBe("all");
    expect(out["settingSources"]).toEqual(["user", "project"]);
  });
});

// [s3-cc2] Context editing + memory tool: opt-in paths
// Both builders now gate on CMAX_CONTEXT_ENGINEERING env (in addition to the
// contextEditing/memoryTool flags in opts). Set the env in beforeEach so the
// opt-in tests exercise the enabled path.
describe("baseSdkOptions context-engineering: opt-in", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  beforeEach(() => {
    process.env[CE_ENV] = "1";
  });
  afterEach(() => {
    delete process.env[CE_ENV];
  });

  it("attaches context_management with edit.protected containing grounding tools when contextEditing:true", () => {
    const out = baseSdkOptions({ contextEditing: true });
    const cm = out["context_management"] as { edit: { protected: string[] } };
    expect(cm).toBeDefined();
    expect(cm.edit).toBeDefined();
    expect(Array.isArray(cm.edit.protected)).toBe(true);
    expect(cm.edit.protected).toContain("mcp__memory__memory_search");
    expect(cm.edit.protected).toContain("mcp__memory__memory_get_decision");
    expect(cm.edit.protected).toContain("mcp__memory__memory_get_fact");
    expect(cm.edit.protected).toContain("mcp__memory__memory_stale");
  });

  it("adds memory_20250818 beta when memoryTool:true", () => {
    const out = baseSdkOptions({ memoryTool: true });
    const betas = out["betas"] as string[];
    expect(Array.isArray(betas)).toBe(true);
    expect(betas).toContain(MEMORY_TOOL_BETA);
  });

  it("preserves TASK_BUDGET_BETA when memoryTool:true is combined with taskBudgetTokens", () => {
    const out = baseSdkOptions({ memoryTool: true, taskBudgetTokens: 50_000 });
    const betas = out["betas"] as string[];
    expect(betas).toContain(MEMORY_TOOL_BETA);
    expect(betas).toContain(TASK_BUDGET_BETA);
  });

  it("contextKind is accepted without changing the protected structure", () => {
    const out = baseSdkOptions({ contextEditing: true, contextKind: "grounding" });
    const cm = out["context_management"] as { edit: { protected: string[] } };
    expect(cm.edit.protected).toContain("mcp__memory__memory_search");
  });

  it("taskBudget is still set when both taskBudgetTokens and memoryTool are active", () => {
    const out = baseSdkOptions({ memoryTool: true, taskBudgetTokens: 20_000 });
    expect(out["taskBudget"]).toEqual({ total: 20_000 });
  });
});

// [prc-error-handling] Graceful failure modes
describe("baseSdkOptions context-engineering: error handling", () => {
  it("does not throw when contextEditing:true and contextKind is empty string", () => {
    expect(() => baseSdkOptions({ contextEditing: true, contextKind: "" })).not.toThrow();
  });

  it("does not throw when contextEditing:true and contextKind is undefined", () => {
    expect(() => baseSdkOptions({ contextEditing: true, contextKind: undefined })).not.toThrow();
  });

  it("does not throw when both memoryTool and contextEditing are true with no other options", () => {
    expect(() => baseSdkOptions({ memoryTool: true, contextEditing: true })).not.toThrow();
  });

  it("does not throw when all new flags are combined with unrelated options", () => {
    expect(() =>
      baseSdkOptions({
        memoryTool: true,
        contextEditing: true,
        contextKind: "grounding",
        taskBudgetTokens: 20_000,
        effort: "max",
      }),
    ).not.toThrow();
  });
});

// [prc-edge-cases] Edge and boundary cases
// Tests that need the memory beta to be present must set CMAX_CONTEXT_ENGINEERING=1.
describe("baseSdkOptions context-engineering: edge cases", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  afterEach(() => {
    delete process.env[CE_ENV];
  });

  it("betas array has no duplicates when memoryTool:true is set with env", () => {
    process.env[CE_ENV] = "1";
    const out = baseSdkOptions({ memoryTool: true });
    const betas = out["betas"] as string[];
    const unique = new Set(betas);
    expect(unique.size).toBe(betas.length);
  });

  it("context_management is not set when contextEditing is falsy (0, null-like)", () => {
    // TypeScript prevents passing 0/null here, but a plain false covers the gate
    expect(baseSdkOptions({ contextEditing: false })["context_management"]).toBeUndefined();
  });

  it("betas contains only memory beta (not TASK_BUDGET_BETA) when only memoryTool is set", () => {
    process.env[CE_ENV] = "1";
    const out = baseSdkOptions({ memoryTool: true });
    const betas = out["betas"] as string[];
    expect(betas).not.toContain(TASK_BUDGET_BETA);
    expect(betas).toContain(MEMORY_TOOL_BETA);
  });

  it("betas is absent (not an empty array) when neither flag is active", () => {
    // Must be undefined, not [], so downstream spread callers don't see an
    // unexpected empty betas key.
    expect(baseSdkOptions({})["betas"]).toBeUndefined();
  });
});

// context-engineering.ts unit tests — updated for off-by-default behavior
describe("buildMemoryToolConfig (unit)", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  afterEach(() => {
    delete process.env[CE_ENV];
  });

  it("returns empty array (no betas) when env is not set", () => {
    delete process.env[CE_ENV];
    const betas = buildMemoryToolConfig();
    expect(betas).toHaveLength(0);
    expect(betas).not.toContain(MEMORY_TOOL_BETA);
  });

  it("returns the memory_20250818 beta string when env=1", () => {
    process.env[CE_ENV] = "1";
    const betas = buildMemoryToolConfig();
    expect(betas).toContain(MEMORY_TOOL_BETA);
    expect(betas.length).toBeGreaterThan(0);
  });
});

describe("buildContextEditingConfig (unit)", () => {
  const CE_ENV = "CMAX_CONTEXT_ENGINEERING";
  afterEach(() => {
    delete process.env[CE_ENV];
  });

  it("returns undefined when env is not set", () => {
    delete process.env[CE_ENV];
    expect(buildContextEditingConfig()).toBeUndefined();
  });

  it("returns an edit.protected array with all four grounding tools when env=1", () => {
    process.env[CE_ENV] = "1";
    const cfg = buildContextEditingConfig();
    const ed = cfg!["edit"] as { protected: string[] };
    expect(ed.protected).toContain("mcp__memory__memory_search");
    expect(ed.protected).toContain("mcp__memory__memory_get_decision");
    expect(ed.protected).toContain("mcp__memory__memory_get_fact");
    expect(ed.protected).toContain("mcp__memory__memory_stale");
  });

  it("accepts any contextKind string without throwing", () => {
    expect(() => buildContextEditingConfig("grounding")).not.toThrow();
    expect(() => buildContextEditingConfig("")).not.toThrow();
    expect(() => buildContextEditingConfig(undefined)).not.toThrow();
  });

  it("does not mutate the internal GROUNDING_TOOLS list across calls", () => {
    process.env[CE_ENV] = "1";
    const first = buildContextEditingConfig() as { edit: { protected: string[] } };
    first.edit.protected.push("injected");
    const second = buildContextEditingConfig() as { edit: { protected: string[] } };
    expect(second.edit.protected).not.toContain("injected");
  });
});
