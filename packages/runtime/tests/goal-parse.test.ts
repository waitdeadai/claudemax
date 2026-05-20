import { describe, expect, it } from "vitest";
import { parseGoalDriverOutput } from "../src/goal.js";

describe("parseGoalDriverOutput", () => {
  it("parses a canonical FINISHED block with evidence and summary", () => {
    const raw = `
FINISHED
- cc-1: src/auth.ts now exports verifyToken
- cc-2: pnpm test --filter auth exit 0
- cc-3: docs/AUTH.md updated
SUMMARY: implemented token verification with TTL caching; all three completion conditions met.`;
    const r = parseGoalDriverOutput(raw);
    expect(r.status).toBe("finished");
    expect(r.evidence["cc-1"]).toBe("src/auth.ts now exports verifyToken");
    expect(r.evidence["cc-2"]).toBe("pnpm test --filter auth exit 0");
    expect(r.evidence["cc-3"]).toBe("docs/AUTH.md updated");
    expect(r.summary).toContain("implemented token verification");
  });

  it("parses a BLOCKED block and returns blocked status with summary", () => {
    const raw = `Some narrative...

BLOCKED
REASON: cannot proceed without DATABASE_URL credential
NEEDS: user to set DATABASE_URL in .env`;
    const r = parseGoalDriverOutput(raw);
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("cannot proceed without DATABASE_URL");
  });

  it("returns max-turns status when neither FINISHED nor BLOCKED present", () => {
    const r = parseGoalDriverOutput("just some output that ran out of turns");
    expect(r.status).toBe("max-turns");
    expect(r.summary).toBe("just some output that ran out of turns");
    expect(r.evidence).toEqual({});
  });

  it("truncates max-turns summary to 4000 chars", () => {
    const raw = "x".repeat(5000);
    const r = parseGoalDriverOutput(raw);
    expect(r.summary.length).toBe(4000);
  });

  it("ignores evidence lines without the dash-id-colon shape", () => {
    const raw = `FINISHED
random line that should not parse
- cc-1: valid
   no-leading-dash
- cc-2: also valid
SUMMARY: done`;
    const r = parseGoalDriverOutput(raw);
    expect(Object.keys(r.evidence).sort()).toEqual(["cc-1", "cc-2"]);
  });
});
