import { MODELS } from "./models.js";
import type { BillingEra, ModelTier, Plan } from "./types.js";
import { BILLING_SPLIT_CUTOVER_ISO } from "./types.js";

// Auto-resolve the billing era from the current date. Anthropic's announced
// cutover is 2026-06-15 (support.claude.com article 15036540 +
// code.claude.com/docs/en/agent-sdk/overview, accessed 2026-05-21). Before
// that date: shared 5-hour rolling subscription pool. After: separate monthly
// Agent SDK credit pool. Override via env CMAX_BILLING_ERA=pre-split|post-split.
export function resolveBillingEra(now: Date = new Date()): BillingEra {
  const override = process.env["CMAX_BILLING_ERA"];
  if (override === "pre-split" || override === "post-split") return override;
  return now.getTime() >= Date.parse(BILLING_SPLIT_CUTOVER_ISO) ? "post-split" : "pre-split";
}

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

// Per Anthropic's announcement (support.claude.com/en/articles/15036540,
// accessed 2026-05-21): the monthly Agent SDK credit pool is $20/$100/$200
// starting 2026-06-15. Before that date these values are nominal — the actual
// envelope today is the shared 5-hour rolling pool + weekly cap. We keep the
// dollar values for forward-compat (cost-guard math) and gate semantics in
// formatPlanBudgetState() + budgetTag() on the resolved era.
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

export function formatPlanBudgetState(
  plan: Plan,
  consumedUsd: number,
  era: BillingEra = resolveBillingEra(),
): string {
  const allocation = MONTHLY_CREDIT_USD[plan];
  if (allocation == null) {
    return `api mode — pay-per-token, no monthly credit; consumed this period: $${consumedUsd.toFixed(2)}`;
  }
  if (era === "pre-split") {
    return `${plan} (pre-split era; until 2026-06-15) — claudemax shares your 5h rolling + weekly subscription pool; cost-guard against $${allocation}/mo is FORWARD-COMPAT only. Consumed this period: $${consumedUsd.toFixed(2)}`;
  }
  const pct = (consumedUsd / allocation) * 100;
  const tag = pct >= 95 ? "blocked" : pct >= 90 ? "danger" : pct >= 70 ? "guard" : "ok";
  return `${plan} (post-split) — $${consumedUsd.toFixed(2)} / $${allocation} Agent SDK credit (${pct.toFixed(1)}%) [${tag}]`;
}

export type BudgetTag = "ok" | "guard" | "danger" | "blocked";

export function budgetTag(
  plan: Plan,
  consumedUsd: number,
  era: BillingEra = resolveBillingEra(),
): BudgetTag {
  // Pre-split era: the monthly Agent SDK credit doesn't exist yet, so we never
  // tag guard/danger/blocked against a fictional envelope. Caller can switch
  // to era="post-split" via env CMAX_BILLING_ERA to dry-run the post-split path.
  if (era === "pre-split") return "ok";
  const allocation = MONTHLY_CREDIT_USD[plan];
  if (allocation == null) return "ok";
  const pct = (consumedUsd / allocation) * 100;
  if (pct >= 95) return "blocked";
  if (pct >= 90) return "danger";
  if (pct >= 70) return "guard";
  return "ok";
}
