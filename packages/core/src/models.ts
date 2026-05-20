import type { ModelId, ModelTier } from "./types.js";

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
// on 2026-05-20. Opus 4.7 input $5 / output $25; Sonnet 4.6 input $3 / output $15;
// Haiku 4.5 input $1 / output $5. Cache write 5m = 1.25× base input; 1h = 2× base input;
// cache read = 0.10× base input (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
export const MODELS: Readonly<Record<ModelTier, ModelSpec>> = {
  opus: {
    tier: "opus",
    id: "claude-opus-4-7",
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
      "high-resolution vision (Opus 4.7)",
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

export const SHORT_NAME_BY_TIER: Readonly<Record<ModelTier, "opus" | "sonnet" | "haiku">> = {
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

export function modelById(id: ModelId): ModelSpec {
  for (const tier of ["opus", "sonnet", "haiku"] as const) {
    if (MODELS[tier].id === id) return MODELS[tier];
  }
  throw new Error(`Unknown model id: ${id}`);
}
