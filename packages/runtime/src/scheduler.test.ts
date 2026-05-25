import { describe, it, expect } from "vitest";
import { isSaturationSignal, parseResetTime } from "./scheduler.js";

describe("isSaturationSignal", () => {
  it("detects the Max subscription session-limit string", () => {
    expect(
      isSaturationSignal(
        "error: Claude Code returned an error result: You've hit your session limit · resets 1:20pm (America/Argentina/Mendoza)",
      ),
    ).toBe(true);
  });

  it("detects burst-protection throttle", () => {
    expect(isSaturationSignal("temporarily limiting requests (not your usage limit)")).toBe(true);
  });

  it("detects generic rate-limit / 429 / usage-limit phrasing", () => {
    expect(isSaturationSignal("HTTP 429 Too Many Requests")).toBe(true);
    expect(isSaturationSignal("rate-limit exceeded")).toBe(true);
    expect(isSaturationSignal("monthly usage limit reached")).toBe(true);
    expect(isSaturationSignal("resets 3pm")).toBe(true);
  });

  it("does NOT fire on ordinary logic-failure output", () => {
    expect(isSaturationSignal("TypeError: cannot read property 'x' of undefined")).toBe(false);
    expect(isSaturationSignal("rollup: partial — 2 conditions unmet")).toBe(false);
    expect(isSaturationSignal("pnpm test: 3 failed")).toBe(false);
  });
});

describe("parseResetTime (smoke)", () => {
  it("parses a human 'resets <X>pm' against a fixed now", () => {
    const now = new Date("2026-05-25T16:00:00-03:00");
    const reset = parseResetTime("You've hit your session limit · resets 1:20pm", now);
    // 1:20pm is earlier than 16:00 (1pm) → next occurrence is tomorrow.
    expect(reset).not.toBeNull();
    expect(reset!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("returns null when no reset pattern is present", () => {
    expect(parseResetTime("no limit info here")).toBeNull();
  });
});
