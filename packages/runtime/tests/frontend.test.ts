import { describe, expect, it } from "vitest";
import {
  buildA11yProbe,
  buildScreenshotProbe,
  DESIGN_RUBRIC,
  frontendNote,
  scoreDesignRubric,
} from "../src/frontend.js";

describe("scoreDesignRubric (graduable, not pass/fail)", () => {
  it("rubric weights sum to 1", () => {
    expect(DESIGN_RUBRIC.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1);
  });

  it("all 10s → weighted 10 and pass", () => {
    const scores = Object.fromEntries(DESIGN_RUBRIC.map((c) => [c.key, 10]));
    const r = scoreDesignRubric(scores);
    expect(r.weighted).toBeCloseTo(10);
    expect(r.pass).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("a vague UI scores low and does not pass (graduable)", () => {
    const scores = Object.fromEntries(DESIGN_RUBRIC.map((c) => [c.key, 4]));
    const r = scoreDesignRubric(scores);
    expect(r.weighted).toBeCloseTo(4);
    expect(r.pass).toBe(false);
  });

  it("a missing criterion blocks pass even if the rest are perfect", () => {
    const scores = Object.fromEntries(DESIGN_RUBRIC.filter((c) => c.key !== "craft").map((c) => [c.key, 10]));
    const r = scoreDesignRubric(scores);
    expect(r.missing).toContain("craft");
    expect(r.pass).toBe(false);
  });
});

describe("buildA11yProbe", () => {
  it("returns a Playwright hint asserting the expected roles, degrading honestly when Playwright is absent", () => {
    const h = buildA11yProbe("http://localhost:3000/login", [
      { role: "textbox", name: "username" },
      { role: "button", name: "submit" },
    ]);
    expect(h.tool).toBe("playwright");
    expect(h.expect).toBe("A11Y_OK");
    expect(h.script).toContain("/login");
    expect(h.script).toContain("username");
    expect(h.script).toContain("PLAYWRIGHT_MISSING");
    expect(h.timeoutMs ?? 0).toBeGreaterThan(0);
  });
});

describe("buildScreenshotProbe + frontendNote", () => {
  it("captures to the given path and the note is honest about Playwright", () => {
    const h = buildScreenshotProbe("http://localhost:3000", "baseline/home.png");
    expect(h.script).toContain("baseline/home.png");
    expect(h.expect).toBe("SCREENSHOT_OK");
    expect(frontendNote()).toContain("PLAYWRIGHT_MISSING");
  });
});
