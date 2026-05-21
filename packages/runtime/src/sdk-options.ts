// Centralized SDK option builders for claudemax runtime.
// Keeps every query() call site consistent with the May 2026 Claude Agent SDK
// surface and the Opus 4.7 behavior changes.

import type { ModelTier } from "@claudemax/core";
import { MODELS } from "@claudemax/core";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

// Anthropic recommends "xhigh" as the default for Opus 4.7 coding/agentic work
// (https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7).
// Users can override to "max" for more tokens at lower cost-effectiveness, or
// down-tier for cheaper/faster.
export const DEFAULT_EFFORT: EffortLevel = "xhigh";

export const TASK_BUDGET_BETA = "task-budgets-2026-03-13";

export interface BaseQueryOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly maxTurns?: number;
  readonly effort?: EffortLevel;
  readonly thinking?: "off" | "adaptive";
  readonly taskBudgetTokens?: number;
  readonly maxBudgetUsd?: number;
  readonly includeHookEvents?: boolean;
  readonly strictMcpConfig?: boolean;
  readonly sessionStoreFlush?: "batched" | "eager";
  readonly abortSignal?: AbortSignal;
  readonly agentId?: string;
  readonly parentAgentId?: string;
  readonly serviceVersion?: string;
}

// OTEL conventions per https://opentelemetry.io/docs/specs/semconv/
// Claude Code Agent SDK v0.3.139+ reads OTEL_RESOURCE_ATTRIBUTES + the
// x-claude-code-agent-id / x-claude-code-parent-agent-id env vars when
// emitting spans (per the v2.1.139 + v2.1.145 changelog).
export function buildOtelEnv(opts: BaseQueryOptions): Record<string, string> {
  const env: Record<string, string> = {};
  const existing = process.env["OTEL_RESOURCE_ATTRIBUTES"] ?? "";
  const attrs = [
    `service.name=claudemax`,
    `service.version=${opts.serviceVersion ?? "0.2.1"}`,
    `deployment.environment=user-cli`,
  ];
  if (opts.agentId) attrs.push(`claudemax.agent_id=${opts.agentId}`);
  if (opts.parentAgentId) attrs.push(`claudemax.parent_agent_id=${opts.parentAgentId}`);
  env["OTEL_RESOURCE_ATTRIBUTES"] = existing
    ? `${existing},${attrs.join(",")}`
    : attrs.join(",");
  if (opts.agentId) env["CLAUDE_CODE_AGENT_ID"] = opts.agentId;
  if (opts.parentAgentId) env["CLAUDE_CODE_PARENT_AGENT_ID"] = opts.parentAgentId;
  if (!process.env["OTEL_SERVICE_NAME"]) env["OTEL_SERVICE_NAME"] = "claudemax";
  return env;
}

// Estimate a task_budget in tokens from a USD budget cap, using the tier's
// pricing. We bias toward more input than output (4:1 input/output ratio
// matches typical agentic loops).
export function estimateTaskBudgetTokens(tier: ModelTier, usdBudget: number): number {
  const m = MODELS[tier];
  // Blend: 80% input, 20% output, accounting for ~50% cache-hit on input
  const effectiveInputCost = m.inputPer1MUsd * 0.5 + m.cachedInputPer1MUsd * 0.5;
  const tokensPerDollar =
    1 / (0.8 * (effectiveInputCost / 1_000_000) + 0.2 * (m.outputPer1MUsd / 1_000_000));
  const total = Math.floor(usdBudget * tokensPerDollar);
  // Anthropic minimum task_budget is 20k tokens
  return Math.max(20_000, total);
}

// Build a baseline option block that every query() call site spreads.
// Returns an `unknown` because the SDK's TS types are typed-stale on some
// options (outputFormat, effort, skills, enableFileCheckpointing, etc.);
// downstream callers cast via `as never` at the query() boundary.
export function baseSdkOptions(o: BaseQueryOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    effort: o.effort ?? DEFAULT_EFFORT,
    settingSources: ["user", "project"],
    skills: "all",
    agentProgressSummaries: true,
    forwardSubagentText: true,
    enableFileCheckpointing: true,
  };
  if (o.cwd) out["cwd"] = o.cwd;
  const otel = buildOtelEnv(o);
  out["env"] = { ...otel, ...(o.env ?? {}) };
  if (o.maxTurns !== undefined) out["maxTurns"] = o.maxTurns;
  if (o.maxBudgetUsd !== undefined) out["maxBudgetUsd"] = o.maxBudgetUsd;
  if (o.thinking === "adaptive") out["thinking"] = { type: "adaptive" };
  if (o.includeHookEvents) out["includeHookEvents"] = true;
  if (o.strictMcpConfig) out["strictMcpConfig"] = true;
  if (o.sessionStoreFlush) out["sessionStoreFlush"] = o.sessionStoreFlush;
  if (o.taskBudgetTokens !== undefined) {
    out["betas"] = [TASK_BUDGET_BETA];
    out["taskBudget"] = { total: o.taskBudgetTokens };
  }
  if (o.abortSignal) {
    const ac = new AbortController();
    o.abortSignal.addEventListener("abort", () => ac.abort());
    out["abortController"] = ac;
  }
  return out;
}

// Parse the SDK's result.usage object for cache token counts.
// The SDK exposes cache_read_input_tokens and cache_creation_input_tokens at
// top level, plus a nested cache_creation: { ephemeral_5m_input_tokens,
// ephemeral_1h_input_tokens } when caching is active.
export interface CacheTokenStats {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
}

// SDK v0.3.145+ with outputFormat:{type:"json_schema",schema:...} emits the
// parsed JSON via two new shapes:
//   - result message: { type:"result", structured_output: {...parsed JSON...} }
//   - assistant message: { type:"assistant", message:{ content:[{ type:"tool_use",
//                          name:"StructuredOutput", input:{...parsed JSON...} }] } }
// The legacy `result.result` string field is now empty for json_schema callers.
// Pre-v0.3.145 callers that parse `result.result` as a JSON string get nothing
// and throw "<callsite> returned no JSON. Raw: " with empty trailing text.
// This helper extracts the parsed JSON object from EITHER message shape; returns
// null if the message isn't structured-output-bearing.
export function extractStructuredOutput(
  message: unknown,
): Record<string, unknown> | null {
  const m = message as {
    type?: string;
    structured_output?: unknown;
    message?: {
      content?: Array<{
        type?: string;
        name?: string;
        input?: unknown;
      }>;
    };
  };
  if (
    m.type === "result" &&
    m.structured_output &&
    typeof m.structured_output === "object"
  ) {
    return m.structured_output as Record<string, unknown>;
  }
  if (m.type === "assistant" && Array.isArray(m.message?.content)) {
    for (const block of m.message.content) {
      if (
        block.type === "tool_use" &&
        block.name === "StructuredOutput" &&
        block.input &&
        typeof block.input === "object"
      ) {
        return block.input as Record<string, unknown>;
      }
    }
  }
  return null;
}

export function parseUsageWithCache(usage: unknown): CacheTokenStats {
  const u = (usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite5m = u.cache_creation?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0;
  const cacheWrite1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: cacheWrite5m,
    cacheWrite1hTokens: cacheWrite1h,
  };
}
