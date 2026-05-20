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
  if (o.env) out["env"] = o.env;
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
