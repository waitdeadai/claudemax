import { describe, expect, it } from "vitest";
import { emptySpec, parseSpecMarkdown, renderSpecMarkdown } from "../src/index.js";

describe("spec roundtrip", () => {
  it("renders and re-parses an empty spec", () => {
    const s = emptySpec("Migration", "Move auth to passkeys");
    const md = renderSpecMarkdown(s);
    const back = parseSpecMarkdown(md);
    expect(back.title).toBe("Migration");
    expect(back.goal).toBe("Move auth to passkeys");
    expect(back.completionConditions.length).toBeGreaterThan(0);
  });
});
