import type { ModelId, ModelTier } from "./types.js";

export interface ModelSpec {
  readonly tier: ModelTier;
  readonly id: ModelId;
  readonly inputPer1MUsd: number;
  readonly outputPer1MUsd: number;
  readonly cachedInputPer1MUsd: number;
  readonly contextWindow: number;
  readonly maxOutput: number;
  readonly strengths: readonly string[];
}

export const MODELS: Readonly<Record<ModelTier, ModelSpec>> = {
  opus: {
    tier: "opus",
    id: "claude-opus-4-7",
    inputPer1MUsd: 15,
    outputPer1MUsd: 75,
    cachedInputPer1MUsd: 1.5,
    contextWindow: 200_000,
    maxOutput: 32_000,
    strengths: [
      "deep reasoning",
      "multi-file architecture",
      "verification skepticism",
      "spec authoring",
      "hard debugging",
    ],
  },
  sonnet: {
    tier: "sonnet",
    id: "claude-sonnet-4-6",
    inputPer1MUsd: 3,
    outputPer1MUsd: 15,
    cachedInputPer1MUsd: 0.3,
    contextWindow: 200_000,
    maxOutput: 32_000,
    strengths: [
      "routine coding",
      "mechanical refactor",
      "test scaffolding",
      "feature implementation",
    ],
  },
  haiku: {
    tier: "haiku",
    id: "claude-haiku-4-5-20251001",
    inputPer1MUsd: 1,
    outputPer1MUsd: 5,
    cachedInputPer1MUsd: 0.1,
    contextWindow: 200_000,
    maxOutput: 32_000,
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
