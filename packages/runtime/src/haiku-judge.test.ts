import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { HAIKU_MODEL_ID, judgeWithHaiku, type JudgeVerdict } from "./haiku-judge.js";

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env["CMAX_BILLING_ERA"];
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function asyncIter<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("HAIKU_MODEL_ID", () => {
  it("is exactly the canonical Haiku 4.5 family id", () => {
    expect(HAIKU_MODEL_ID).toBe("claude-haiku-4-5");
  });
});

describe("judgeWithHaiku — budget gate", () => {
  it("short-circuits to action=LOG / reason=budget_gate_skipped when budgetTag is >=guard", async () => {
    process.env["CMAX_BILLING_ERA"] = "post-split";
    const queryFn = vi.fn();
    const result = await judgeWithHaiku(
      { content: "candidate text", plan: "max5x", consumedUsd: 80 },
      { queryFn: queryFn as unknown as typeof sdkQuery },
    );
    expect(result.action).toBe("LOG");
    expect(result.reason).toBe("budget_gate_skipped");
    expect(result.model).toBe("claude-haiku-4-5");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit when budget tag is ok (consumption below 70%)", async () => {
    process.env["CMAX_BILLING_ERA"] = "post-split";
    const queryFn = vi.fn(() => asyncIter([]));
    await judgeWithHaiku(
      { content: "candidate text", plan: "max5x", consumedUsd: 10 },
      { queryFn: queryFn as unknown as typeof sdkQuery },
    );
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("judgeWithHaiku — fail-CLOSED on SDK error", () => {
  it("catches thrown errors and returns action=LOG / reason=haiku_unavailable", async () => {
    process.env["CMAX_BILLING_ERA"] = "post-split";
    const queryFn = vi.fn(() => {
      throw new Error("network down");
    });
    const result = await judgeWithHaiku(
      { content: "x", plan: "max5x", consumedUsd: 0 },
      { queryFn: queryFn as unknown as typeof sdkQuery },
    );
    expect(result.action).toBe("LOG");
    expect(result.reason).toBe("haiku_unavailable");
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("does not throw out of judgeWithHaiku for any failure mode", async () => {
    const queryFn = vi.fn(() => {
      throw new Error("anything");
    });
    await expect(
      judgeWithHaiku(
        { content: "x" },
        { queryFn: queryFn as unknown as typeof sdkQuery },
      ),
    ).resolves.toBeDefined();
  });
});

describe("judgeWithHaiku — return value schema shape", () => {
  it("always includes the four spec-required fields with the right types", async () => {
    process.env["CMAX_BILLING_ERA"] = "post-split";
    const queryFn = vi.fn(() => asyncIter([]));
    const result: JudgeVerdict = await judgeWithHaiku(
      { content: "x", plan: "max5x", consumedUsd: 0 },
      { queryFn: queryFn as unknown as typeof sdkQuery },
    );
    expect(typeof result.action).toBe("string");
    expect(["BLOCK", "REDACT", "WARN", "LOG"]).toContain(result.action);
    expect(typeof result.reason).toBe("string");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.model).toBe("string");
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("passes the exact 'claude-haiku-4-5' model id into the SDK options", async () => {
    process.env["CMAX_BILLING_ERA"] = "post-split";
    let capturedOptions: Record<string, unknown> | undefined;
    const queryFn = vi.fn((params: { options?: Record<string, unknown> }) => {
      capturedOptions = params.options;
      return asyncIter([]);
    });
    await judgeWithHaiku(
      { content: "x" },
      { queryFn: queryFn as unknown as typeof sdkQuery },
    );
    expect(capturedOptions?.["model"]).toBe("claude-haiku-4-5");
  });
});
