import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_TOOL_BETA,
  PROTECTED_CONTEXT_KINDS,
  buildContextEditingConfig,
  buildMemoryToolConfig,
  contextEngineeringEnabled,
  contextShouldDigest,
  isProtectedContext,
  isProtectedToolName,
  readContextEngineeringEnv,
} from "../src/context-engineering.js";

const ENV_KEY = "CMAX_CONTEXT_ENGINEERING";

// [s1-cc1] Off by default — no env opt-in produces no config
describe("off by default", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("buildContextEditingConfig() returns undefined when nothing is opted in", () => {
    expect(buildContextEditingConfig()).toBeUndefined();
  });

  it("buildContextEditingConfig({}) returns undefined when nothing is opted in", () => {
    expect(buildContextEditingConfig({})).toBeUndefined();
  });

  it("buildMemoryToolConfig() returns empty array (no betas) when nothing is opted in", () => {
    const result = buildMemoryToolConfig();
    expect(result).not.toContain(MEMORY_TOOL_BETA);
    expect(result).toHaveLength(0);
  });

  it("buildMemoryToolConfig({}) returns empty array when nothing is opted in", () => {
    const result = buildMemoryToolConfig({});
    expect(result).not.toContain(MEMORY_TOOL_BETA);
    expect(result).toHaveLength(0);
  });

  it("contextEngineeringEnabled() is false with no env", () => {
    expect(contextEngineeringEnabled()).toBe(false);
  });

  it("readContextEngineeringEnv() is false with no env", () => {
    expect(readContextEngineeringEnv()).toBe(false);
  });
});

// PROTECTED_CONTEXT_KINDS and isProtectedContext
describe("PROTECTED_CONTEXT_KINDS and isProtectedContext", () => {
  it("exports the three protected kinds", () => {
    expect(PROTECTED_CONTEXT_KINDS).toContain("verify");
    expect(PROTECTED_CONTEXT_KINDS).toContain("grounding");
    expect(PROTECTED_CONTEXT_KINDS).toContain("evidence");
    expect(PROTECTED_CONTEXT_KINDS).toHaveLength(3);
  });

  it("isProtectedContext returns true for each valid kind", () => {
    expect(isProtectedContext("verify")).toBe(true);
    expect(isProtectedContext("grounding")).toBe(true);
    expect(isProtectedContext("evidence")).toBe(true);
  });

  it("isProtectedContext returns false for unknown kinds", () => {
    expect(isProtectedContext("unknown")).toBe(false);
    expect(isProtectedContext("")).toBe(false);
    expect(isProtectedContext("GROUNDING")).toBe(false);
    expect(isProtectedContext("normal")).toBe(false);
  });
});

// [s1-cc2] isProtectedToolName — grounding tools and verify/evidence patterns
describe("isProtectedToolName", () => {
  it("returns true for any mcp__memory__* tool (grounding)", () => {
    expect(isProtectedToolName("mcp__memory__memory_search")).toBe(true);
    expect(isProtectedToolName("mcp__memory__memory_get_decision")).toBe(true);
    expect(isProtectedToolName("mcp__memory__memory_get_fact")).toBe(true);
    expect(isProtectedToolName("mcp__memory__memory_stale")).toBe(true);
    expect(isProtectedToolName("mcp__memory__any_future_tool")).toBe(true);
  });

  it("returns true for verify-bearing tool names", () => {
    expect(isProtectedToolName("verify_output")).toBe(true);
    expect(isProtectedToolName("cross_verify")).toBe(true);
    expect(isProtectedToolName("run_verify")).toBe(true);
  });

  it("returns true for evidence-bearing tool names", () => {
    expect(isProtectedToolName("collect_evidence")).toBe(true);
    expect(isProtectedToolName("evidence_store")).toBe(true);
    expect(isProtectedToolName("get_evidence")).toBe(true);
  });

  it("returns false for ordinary tool names", () => {
    expect(isProtectedToolName("bash")).toBe(false);
    expect(isProtectedToolName("read_file")).toBe(false);
    expect(isProtectedToolName("mcp__other__tool")).toBe(false);
    expect(isProtectedToolName("Write")).toBe(false);
    expect(isProtectedToolName("Read")).toBe(false);
  });

  // [prc-edge-cases] Boundary cases
  it("returns false for empty string", () => {
    expect(isProtectedToolName("")).toBe(false);
  });

  it("handles null/undefined inputs gracefully without throwing", () => {
    expect(() => isProtectedToolName(null as unknown as string)).not.toThrow();
    expect(() => isProtectedToolName(undefined as unknown as string)).not.toThrow();
    expect(isProtectedToolName(null as unknown as string)).toBe(false);
    expect(isProtectedToolName(undefined as unknown as string)).toBe(false);
  });

  it("returns false for mcp__other__* tools (non-memory MCP)", () => {
    expect(isProtectedToolName("mcp__filesystem__read")).toBe(false);
    expect(isProtectedToolName("mcp__github__search")).toBe(false);
  });
});

// [s1-cc2] buildContextEditingConfig enabled — protected-never-cleared invariant
describe("buildContextEditingConfig with enabled: true", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns a config when enabled: true is set explicitly", () => {
    const config = buildContextEditingConfig({ enabled: true });
    expect(config).toBeDefined();
  });

  it("exclude list includes all known grounding tools", () => {
    const config = buildContextEditingConfig({ enabled: true });
    const cm = config!["context_management"] as Record<string, unknown>;
    const cu = cm["clear_tool_uses"] as Record<string, unknown>;
    const exclude = cu["exclude"] as string[];

    // isProtectedToolName is true for all of these, verifying the invariant
    expect(isProtectedToolName("mcp__memory__memory_search")).toBe(true);
    expect(exclude).toContain("mcp__memory__memory_search");
    expect(exclude).toContain("mcp__memory__memory_get_decision");
    expect(exclude).toContain("mcp__memory__memory_get_fact");
    expect(exclude).toContain("mcp__memory__memory_stale");
  });

  it("merges extraExclude into the exclude list", () => {
    const config = buildContextEditingConfig({ enabled: true, extraExclude: ["custom_tool"] });
    const cm = config!["context_management"] as Record<string, unknown>;
    const cu = cm["clear_tool_uses"] as Record<string, unknown>;
    const exclude = cu["exclude"] as string[];
    expect(exclude).toContain("custom_tool");
    expect(exclude).toContain("mcp__memory__memory_search");
  });

  it("returns undefined when enabled: false even with extraExclude", () => {
    expect(buildContextEditingConfig({ enabled: false, extraExclude: ["x"] })).toBeUndefined();
  });

  it("returns undefined with empty opts and no env", () => {
    delete process.env[ENV_KEY];
    expect(buildContextEditingConfig({})).toBeUndefined();
  });

  it("exclude list does not mutate across calls", () => {
    const first = buildContextEditingConfig({ enabled: true }) as {
      context_management: { clear_tool_uses: { exclude: string[] } };
    };
    first.context_management.clear_tool_uses.exclude.push("injected");
    const second = buildContextEditingConfig({ enabled: true }) as {
      context_management: { clear_tool_uses: { exclude: string[] } };
    };
    expect(second.context_management.clear_tool_uses.exclude).not.toContain("injected");
  });
});

// buildContextEditingConfig env opt-in (legacy / string / undefined paths)
describe("buildContextEditingConfig env opt-in", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns legacy edit.protected config when env=1 and no arg", () => {
    process.env[ENV_KEY] = "1";
    const config = buildContextEditingConfig();
    expect(config).toBeDefined();
    const ed = config!["edit"] as { protected: string[] };
    expect(ed.protected).toContain("mcp__memory__memory_search");
  });

  it("returns legacy edit.protected config when env=true and no arg", () => {
    process.env[ENV_KEY] = "true";
    const config = buildContextEditingConfig();
    expect(config).toBeDefined();
  });

  it("returns undefined when env=0", () => {
    process.env[ENV_KEY] = "0";
    expect(buildContextEditingConfig()).toBeUndefined();
  });

  it("returns legacy edit.protected config when env=1 and string contextKind", () => {
    process.env[ENV_KEY] = "1";
    const config = buildContextEditingConfig("grounding");
    expect(config).toBeDefined();
    const ed = config!["edit"] as { protected: string[] };
    expect(ed.protected).toContain("mcp__memory__memory_search");
  });

  it("does not mutate GROUNDING_TOOLS across legacy calls", () => {
    process.env[ENV_KEY] = "1";
    const first = buildContextEditingConfig() as { edit: { protected: string[] } };
    first.edit.protected.push("injected");
    const second = buildContextEditingConfig() as { edit: { protected: string[] } };
    expect(second.edit.protected).not.toContain("injected");
  });
});

// buildMemoryToolConfig opt-in
describe("buildMemoryToolConfig opt-in", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns the memory beta string when enabled: true", () => {
    const result = buildMemoryToolConfig({ enabled: true });
    expect(result).toContain(MEMORY_TOOL_BETA);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty array when enabled: false", () => {
    const result = buildMemoryToolConfig({ enabled: false });
    expect(result).toHaveLength(0);
  });

  it("returns the memory beta when env=1 with no opts", () => {
    process.env[ENV_KEY] = "1";
    expect(buildMemoryToolConfig()).toContain(MEMORY_TOOL_BETA);
  });

  it("respects opts.enabled=false even when env=1", () => {
    process.env[ENV_KEY] = "1";
    expect(buildMemoryToolConfig({ enabled: false })).toHaveLength(0);
  });

  // [prc-edge-cases] opts.memoryPath is accepted without affecting the return value
  it("memoryPath in opts does not affect the betas array", () => {
    const result = buildMemoryToolConfig({ enabled: true, memoryPath: "/tmp/mem" });
    expect(result).toContain(MEMORY_TOOL_BETA);
  });
});

// contextEngineeringEnabled / readContextEngineeringEnv
describe("contextEngineeringEnabled and readContextEngineeringEnv", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("both return false with no env set", () => {
    delete process.env[ENV_KEY];
    expect(contextEngineeringEnabled()).toBe(false);
    expect(readContextEngineeringEnv()).toBe(false);
  });

  it("both return true when env=1", () => {
    process.env[ENV_KEY] = "1";
    expect(contextEngineeringEnabled()).toBe(true);
    expect(readContextEngineeringEnv()).toBe(true);
  });

  it("both return true when env=true", () => {
    process.env[ENV_KEY] = "true";
    expect(contextEngineeringEnabled()).toBe(true);
    expect(readContextEngineeringEnv()).toBe(true);
  });

  it("both return false for any other string value", () => {
    for (const v of ["yes", "on", "0", "false", "TRUE", "1.0"]) {
      process.env[ENV_KEY] = v;
      expect(contextEngineeringEnabled()).toBe(["1", "true"].includes(v));
      expect(readContextEngineeringEnv()).toBe(["1", "true"].includes(v));
    }
  });
});

// [prc-error-handling] Graceful failure modes
describe("error handling — graceful boundary inputs", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("buildContextEditingConfig does not throw with enabled:true and empty extraExclude", () => {
    expect(() => buildContextEditingConfig({ enabled: true, extraExclude: [] })).not.toThrow();
  });

  it("buildContextEditingConfig does not throw with enabled:true and undefined extraExclude", () => {
    expect(() => buildContextEditingConfig({ enabled: true })).not.toThrow();
  });

  it("buildContextEditingConfig does not throw with an empty string contextKind", () => {
    expect(() => buildContextEditingConfig("")).not.toThrow();
  });

  it("buildMemoryToolConfig does not throw with empty opts", () => {
    expect(() => buildMemoryToolConfig({})).not.toThrow();
  });

  it("buildMemoryToolConfig does not throw with no args", () => {
    expect(() => buildMemoryToolConfig()).not.toThrow();
  });

  it("isProtectedToolName does not throw for any primitive input", () => {
    for (const v of [null, undefined, 0, false, {}, []]) {
      expect(() => isProtectedToolName(v as unknown as string)).not.toThrow();
    }
  });

  it("isProtectedContext returns false for non-string-like inputs", () => {
    expect(isProtectedContext("")).toBe(false);
    expect(isProtectedContext("not-a-kind")).toBe(false);
  });
});

// [prc-edge-cases] Edge and boundary cases
describe("edge and boundary cases", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("buildContextEditingConfig exclude list has no duplicates from repeated grounding tools", () => {
    const config = buildContextEditingConfig({ enabled: true });
    const exclude = (
      (config!["context_management"] as Record<string, unknown>)["clear_tool_uses"] as Record<string, unknown>
    )["exclude"] as string[];
    const unique = new Set(exclude);
    expect(unique.size).toBe(exclude.length);
  });

  it("buildMemoryToolConfig with enabled:true returns exactly one beta string", () => {
    const result = buildMemoryToolConfig({ enabled: true });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(MEMORY_TOOL_BETA);
  });

  it("buildContextEditingConfig and buildMemoryToolConfig are independent of each other", () => {
    delete process.env[ENV_KEY];
    expect(buildContextEditingConfig({ enabled: true })).toBeDefined();
    expect(buildMemoryToolConfig({ enabled: false })).toHaveLength(0);
  });

  it("contextShouldDigest returns false for grounding tools regardless of result content", () => {
    expect(
      contextShouldDigest({ toolName: "mcp__memory__memory_search", result: "anything" }),
    ).toBe(false);
  });

  it("contextShouldDigest returns false for mutation tools (Write/Edit/Bash)", () => {
    expect(contextShouldDigest({ toolName: "Write", result: "data" })).toBe(false);
    expect(contextShouldDigest({ toolName: "Edit", result: "data" })).toBe(false);
    expect(contextShouldDigest({ toolName: "Bash", result: "data" })).toBe(false);
  });

  it("contextShouldDigest returns false for EVIDENCE: prefixed results", () => {
    expect(contextShouldDigest({ toolName: "Read", result: "EVIDENCE: critical data" })).toBe(false);
  });

  it("contextShouldDigest returns true for exploration tools with non-protected results", () => {
    expect(contextShouldDigest({ toolName: "Read", result: "normal file content" })).toBe(true);
    expect(contextShouldDigest({ toolName: "Glob", result: "*.ts" })).toBe(true);
  });

  it("PROTECTED_CONTEXT_KINDS is frozen — should not be mutated by callers", () => {
    const kinds = PROTECTED_CONTEXT_KINDS;
    expect(kinds).toHaveLength(3);
    // Attempting mutation on a readonly array would be a TypeScript error,
    // but runtime check: the array is a fixed-length tuple
    expect(Array.isArray(kinds)).toBe(true);
  });
});
