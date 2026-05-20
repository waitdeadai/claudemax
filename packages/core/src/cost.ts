import { MODELS } from "./models.js";
import type { ModelTier, Plan } from "./types.js";

export interface UsageEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWrite5mTokens?: number;
  readonly cacheWrite1hTokens?: number;
}

export interface CacheStats {
  readonly hitRatePct: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly billedInputTokens: number;
  readonly savedUsd: number;
}

export const MONTHLY_CREDIT_USD: Readonly<Record<Plan, number | null>> = {
  max20x: 200,
  max5x: 100,
  pro: 20,
  api: null,
};

export function estimateCostUsd(tier: ModelTier, u: UsageEstimate): number {
  const m = MODELS[tier];
  const cached = u.cachedInputTokens ?? 0;
  const cacheWrite5m = u.cacheWrite5mTokens ?? 0;
  const cacheWrite1h = u.cacheWrite1hTokens ?? 0;
  const billedInput = Math.max(0, u.inputTokens - cached - cacheWrite5m - cacheWrite1h);
  return (
    (billedInput / 1_000_000) * m.inputPer1MUsd +
    (cached / 1_000_000) * m.cachedInputPer1MUsd +
    (cacheWrite5m / 1_000_000) * m.cacheWrite5mPer1MUsd +
    (cacheWrite1h / 1_000_000) * m.cacheWrite1hPer1MUsd +
    (u.outputTokens / 1_000_000) * m.outputPer1MUsd
  );
}

export function cacheStatsFromUsage(tier: ModelTier, u: UsageEstimate): CacheStats {
  const m = MODELS[tier];
  const cacheRead = u.cachedInputTokens ?? 0;
  const cacheWrite = (u.cacheWrite5mTokens ?? 0) + (u.cacheWrite1hTokens ?? 0);
  const billedInput = Math.max(0, u.inputTokens - cacheRead - cacheWrite);
  const totalInput = u.inputTokens || 1;
  const hitRatePct = (cacheRead / totalInput) * 100;
  // If cache_read tokens had been billed at full input rate, this is what we would have paid.
  const counterfactual = (cacheRead / 1_000_000) * m.inputPer1MUsd;
  const actual = (cacheRead / 1_000_000) * m.cachedInputPer1MUsd;
  return {
    hitRatePct,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    billedInputTokens: billedInput,
    savedUsd: Math.max(0, counterfactual - actual),
  };
}

// Per-packet cost estimate assuming the SDK's claude_code preset system prompt
// is cached after the first turn. We model ~50% of static input as cache_read on
// subsequent calls (the typical hit rate per Anthropic prompt-caching docs).
export function estimatePacketCost(tier: ModelTier, complexity: number): number {
  const totalInput = 8_000 + complexity * 4_000;
  const cachedInput = Math.floor(totalInput * 0.5);
  const inputTokens = totalInput;
  const outputTokens = 2_000 + complexity * 1_500;
  return estimateCostUsd(tier, { inputTokens, outputTokens, cachedInputTokens: cachedInput });
}

export interface FormatCostOptions {
  readonly plan?: Plan;
  readonly consumedUsd?: number;
}

export function formatCost(usd: number, opts: FormatCostOptions = {}): string {
  const dollars = `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`;
  if (!opts.plan || opts.plan === "api") return dollars;
  const allocation = MONTHLY_CREDIT_USD[opts.plan];
  if (allocation == null) return dollars;
  const pct = ((usd / allocation) * 100).toFixed(1);
  return `${dollars}  •  ${pct}% of $${allocation} monthly credit`;
}

export function formatPlanBudgetState(plan: Plan, consumedUsd: number): string {
  const allocation = MONTHLY_CREDIT_USD[plan];
  if (allocation == null) {
    return `api mode — pay-per-token, no monthly credit; consumed this period: $${consumedUsd.toFixed(2)}`;
  }
  const pct = (consumedUsd / allocation) * 100;
  const tag =
    pct >= 95 ? "blocked" : pct >= 90 ? "danger" : pct >= 70 ? "guard" : "ok";
  return `${plan} — $${consumedUsd.toFixed(2)} / $${allocation} (${pct.toFixed(1)}%) [${tag}]`;
}

export type BudgetTag = "ok" | "guard" | "danger" | "blocked";

export function budgetTag(plan: Plan, consumedUsd: number): BudgetTag {
  const allocation = MONTHLY_CREDIT_USD[plan];
  if (allocation == null) return "ok";
  const pct = (consumedUsd / allocation) * 100;
  if (pct >= 95) return "blocked";
  if (pct >= 90) return "danger";
  if (pct >= 70) return "guard";
  return "ok";
}
