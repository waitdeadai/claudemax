import { describe, expect, it } from "vitest";
import {
  MODELS,
  cacheStatsFromUsage,
  estimateCostUsd,
} from "../src/index.js";

describe("pricing — verified 2026-05-20 against platform.claude.com", () => {
  it("Opus 4.7 is $5 input / $25 output per MTok (NOT the old $15/$75 Opus 4.5 era)", () => {
    expect(MODELS.opus.inputPer1MUsd).toBe(5);
    expect(MODELS.opus.outputPer1MUsd).toBe(25);
  });

  it("Sonnet 4.6 is $3 input / $15 output per MTok", () => {
    expect(MODELS.sonnet.inputPer1MUsd).toBe(3);
    expect(MODELS.sonnet.outputPer1MUsd).toBe(15);
  });

  it("Haiku 4.5 is $1 input / $5 output per MTok", () => {
    expect(MODELS.haiku.inputPer1MUsd).toBe(1);
    expect(MODELS.haiku.outputPer1MUsd).toBe(5);
  });

  it("cache write 5m = 1.25× base input; 1h = 2× base input; read = 0.1× base input", () => {
    for (const tier of ["opus", "sonnet", "haiku"] as const) {
      const m = MODELS[tier];
      expect(m.cacheWrite5mPer1MUsd).toBeCloseTo(m.inputPer1MUsd * 1.25, 2);
      expect(m.cacheWrite1hPer1MUsd).toBeCloseTo(m.inputPer1MUsd * 2, 2);
      expect(m.cachedInputPer1MUsd).toBeCloseTo(m.inputPer1MUsd * 0.1, 2);
    }
  });

  it("Opus 4.7 has 1M context window + 128k max output", () => {
    expect(MODELS.opus.contextWindow).toBe(1_000_000);
    expect(MODELS.opus.maxOutput).toBe(128_000);
  });

  it("Sonnet 4.6 has 1M context window + 64k max output", () => {
    expect(MODELS.sonnet.contextWindow).toBe(1_000_000);
    expect(MODELS.sonnet.maxOutput).toBe(64_000);
  });
});

describe("cache stats from usage", () => {
  it("100% cache miss: hitRate=0, no savings", () => {
    const s = cacheStatsFromUsage("opus", {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    expect(s.hitRatePct).toBe(0);
    expect(s.cacheReadTokens).toBe(0);
    expect(s.savedUsd).toBe(0);
    expect(s.billedInputTokens).toBe(100_000);
  });

  it("90% cache hit on Opus: ~$0.405 saved on 90k cached tokens", () => {
    const s = cacheStatsFromUsage("opus", {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 90_000,
    });
    expect(s.hitRatePct).toBe(90);
    expect(s.cacheReadTokens).toBe(90_000);
    expect(s.billedInputTokens).toBe(10_000);
    // saved = 90_000 * ($5 - $0.5) / 1_000_000 = $0.405
    expect(s.savedUsd).toBeCloseTo(0.405, 3);
  });

  it("cache write tokens count toward billedInput exclusion (not billed at full input rate)", () => {
    const s = cacheStatsFromUsage("opus", {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWrite5mTokens: 80_000,
    });
    expect(s.cacheWriteTokens).toBe(80_000);
    expect(s.billedInputTokens).toBe(20_000);
  });
});

describe("estimateCostUsd factors cache writes", () => {
  it("5m cache write at $6.25/MTok (Opus) costs 1.25× base input", () => {
    const cost = estimateCostUsd("opus", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWrite5mTokens: 1_000_000,
    });
    // 1M tokens of cache_write_5m × $6.25/MTok = $6.25, billed input = 0
    expect(cost).toBeCloseTo(6.25, 2);
  });

  it("cache read at $0.5/MTok (Opus) is 90% cheaper than full input ($5/MTok)", () => {
    const fullInput = estimateCostUsd("opus", { inputTokens: 1_000_000, outputTokens: 0 });
    const allCached = estimateCostUsd("opus", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(fullInput).toBeCloseTo(5, 2);
    expect(allCached).toBeCloseTo(0.5, 2);
    expect(allCached / fullInput).toBeCloseTo(0.1, 2);
  });
});
