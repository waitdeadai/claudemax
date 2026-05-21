import { describe, expect, it } from "vitest";
import {
  DEFAULT_SATURATION_THRESHOLD,
  evaluateSaturation,
  isRateLimitEvent,
  type RateLimitEvent,
} from "../src/saturation.js";

function ev(info: Record<string, unknown>): RateLimitEvent {
  return {
    type: "rate_limit_event",
    rate_limit_info: info as RateLimitEvent["rate_limit_info"],
    uuid: "uuid-1",
    session_id: "sess-1",
  };
}

describe("isRateLimitEvent", () => {
  it("matches the documented type discriminator", () => {
    expect(isRateLimitEvent({ type: "rate_limit_event" })).toBe(true);
    expect(isRateLimitEvent({ type: "assistant" })).toBe(false);
    expect(isRateLimitEvent(null)).toBe(false);
  });
});

describe("evaluateSaturation", () => {
  it("status=exceeded triggers pause regardless of utilization", () => {
    const d = evaluateSaturation(ev({ status: "exceeded", rateLimitType: "five_hour" }));
    expect(d.paused).toBe(true);
    expect(d.bucket).toBe("five_hour");
  });

  it("utilization above threshold on five_hour pauses", () => {
    const d = evaluateSaturation(
      ev({ status: "warning", rateLimitType: "five_hour", utilization: 0.92 }),
    );
    expect(d.paused).toBe(true);
    expect(d.utilization).toBe(0.92);
  });

  it("utilization above threshold on seven_day_opus pauses (Opus burns this bucket fastest)", () => {
    const d = evaluateSaturation(
      ev({ status: "warning", rateLimitType: "seven_day_opus", utilization: 0.88 }),
    );
    expect(d.paused).toBe(true);
  });

  it("utilization above threshold on seven_day_sonnet does NOT pause (not in PAUSE_BUCKETS)", () => {
    const d = evaluateSaturation(
      ev({ status: "warning", rateLimitType: "seven_day_sonnet", utilization: 0.95 }),
    );
    expect(d.paused).toBe(false);
  });

  it("utilization below threshold does NOT pause", () => {
    const d = evaluateSaturation(
      ev({ status: "allowed", rateLimitType: "five_hour", utilization: 0.5 }),
    );
    expect(d.paused).toBe(false);
  });

  it("missing utilization (typical low-saturation event) does NOT pause", () => {
    const d = evaluateSaturation(ev({ status: "allowed", rateLimitType: "five_hour" }));
    expect(d.paused).toBe(false);
  });

  it("unknown bucket name with high utilization does NOT pause (open enum, conservative)", () => {
    const d = evaluateSaturation(
      ev({ status: "warning", rateLimitType: "monthly_agent_sdk", utilization: 0.99 }),
    );
    expect(d.paused).toBe(false);
  });

  it("custom threshold overrides the default", () => {
    const e = ev({ status: "warning", rateLimitType: "five_hour", utilization: 0.6 });
    expect(evaluateSaturation(e, 0.5).paused).toBe(true);
    expect(evaluateSaturation(e, DEFAULT_SATURATION_THRESHOLD).paused).toBe(false);
  });
});
