import type { BillingEra, ModelId, ModelTier } from "./types.js";

export interface ModelSpec {
  readonly tier: ModelTier;
  readonly id: ModelId;
  readonly inputPer1MUsd: number;
  readonly outputPer1MUsd: number;
  readonly cachedInputPer1MUsd: number;
  readonly cacheWrite5mPer1MUsd: number;
  readonly cacheWrite1hPer1MUsd: number;
  readonly contextWindow: number;
  readonly maxOutput: number;
  readonly strengths: readonly string[];
}

// Pricing verified against https://platform.claude.com/docs/en/about-claude/models/overview
// on 2026-05-28 (Opus 4.8 launch day) and re-verified 2026-06-09 (Fable 5 launch day).
// Fable 5 input $10 / output $50 (2× Opus 4.8, no long-context premium for 1M).
// Opus 4.8 input $5 / output $25 — UNCHANGED from Opus 4.7. Sonnet 4.6 input $3 /
// output $15; Haiku 4.5 input $1 / output $5. Cache write 5m = 1.25× base input;
// 1h = 2× base input; cache read = 0.10× base input
// (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
export const MODELS: Readonly<Record<ModelTier, ModelSpec>> = {
  fable: {
    tier: "fable",
    id: "claude-fable-5",
    inputPer1MUsd: 10,
    outputPer1MUsd: 50,
    cachedInputPer1MUsd: 1,
    cacheWrite5mPer1MUsd: 12.5,
    cacheWrite1hPer1MUsd: 20,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    strengths: [
      "long-horizon agentic work (tasks larger than a single sitting)",
      "ambiguous root-cause investigation",
      "outcome-driven autonomy (describe the outcome, not the steps)",
      "self-verification without reminders",
      "codebase-scale migration",
      "1M token context",
    ],
  },
  opus: {
    tier: "opus",
    id: "claude-opus-4-8",
    inputPer1MUsd: 5,
    outputPer1MUsd: 25,
    cachedInputPer1MUsd: 0.5,
    cacheWrite5mPer1MUsd: 6.25,
    cacheWrite1hPer1MUsd: 10,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    strengths: [
      "deep reasoning",
      "multi-file architecture",
      "verification skepticism",
      "spec authoring",
      "hard debugging",
      "high-resolution vision (Opus 4.8)",
      "honest self-review (Opus 4.8: 4× fewer unflagged code flaws than 4.7)",
      "1M token context",
    ],
  },
  sonnet: {
    tier: "sonnet",
    id: "claude-sonnet-4-6",
    inputPer1MUsd: 3,
    outputPer1MUsd: 15,
    cachedInputPer1MUsd: 0.3,
    cacheWrite5mPer1MUsd: 3.75,
    cacheWrite1hPer1MUsd: 6,
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    strengths: [
      "routine coding",
      "mechanical refactor",
      "test scaffolding",
      "feature implementation",
      "1M token context",
    ],
  },
  haiku: {
    tier: "haiku",
    id: "claude-haiku-4-5-20251001",
    inputPer1MUsd: 1,
    outputPer1MUsd: 5,
    cachedInputPer1MUsd: 0.1,
    cacheWrite5mPer1MUsd: 1.25,
    cacheWrite1hPer1MUsd: 2,
    contextWindow: 200_000,
    maxOutput: 64_000,
    strengths: [
      "search and summarize",
      "classification",
      "high-throughput cheap work",
    ],
  },
};

// "fable" is a Claude Code CLI alias (model-config docs, accessed 2026-06-09)
// but NOT yet a documented Agent SDK query() alias — SDK call sites must pass
// the full id MODELS.fable.id ("claude-fable-5"), never the short name.
export const SHORT_NAME_BY_TIER: Readonly<
  Record<ModelTier, "fable" | "opus" | "sonnet" | "haiku">
> = {
  fable: "fable",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

export function modelById(id: ModelId): ModelSpec {
  for (const tier of ["fable", "opus", "sonnet", "haiku"] as const) {
    if (MODELS[tier].id === id) return MODELS[tier];
  }
  throw new Error(`Unknown model id: ${id}`);
}

/** The two FAT-umbrella variants. */
export type Variant = "opussonnet" | "opusolo";

/**
 * Executor model for a variant's sub-Spec execution.
 * - opusolo    → Opus executes everything, every era.
 * - opussonnet → era-aware. In the PRE-SPLIT era (until 2026-06-15) Opus and
 *   Sonnet draw from the SAME shared 5h subscription pool, so the cost rationale
 *   for Sonnet execution evaporates — execute sub-Specs on Opus 4.8 for maximum
 *   effectiveness (4× fewer unflagged flaws than 4.7, agentic coding 64.3→69.2).
 *   In the POST-SPLIT era per-token Agent-SDK billing makes the split economically
 *   real again → revert to Sonnet. `--cheap` / explicit Sonnet remains the
 *   cost-conscious escape hatch regardless of era.
 * Planning (decompose) and verification are NOT routed by this — they always
 * stay on Opus regardless of variant or era (house rule #4).
 *
 * `era` defaults to "post-split" so the pure function keeps its documented
 * stable contract (opussonnet→Sonnet) for callers/tests that don't pass an era;
 * the runtime supplies the LIVE era via resolveBillingEra() at the call site.
 */
export function execModelForVariant(
  variant: Variant,
  era: BillingEra = "post-split",
): ModelId {
  if (variant === "opusolo") return MODELS.opus.id;
  return era === "pre-split" ? MODELS.opus.id : MODELS.sonnet.id;
}
