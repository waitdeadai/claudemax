import { describe, expect, it } from "vitest";
import {
  evaluateExpect,
  extractSalientTokens,
  runInteractiveVerify,
} from "../src/interactive-verify.js";

describe("runInteractiveVerify (shell tool)", () => {
  it("passes when script exits 0 and expect matches", async () => {
    const r = await runInteractiveVerify({
      tool: "shell",
      script: "echo claudemax-ok",
      expect: "claudemax-ok",
    });
    expect(r.met).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdoutTail).toContain("claudemax-ok");
  });

  it("fails when script exits non-zero", async () => {
    const r = await runInteractiveVerify({
      tool: "shell",
      script: "exit 17",
    });
    expect(r.met).toBe(false);
    expect(r.exitCode).toBe(17);
  });

  it("fails when expect is set but not present in output", async () => {
    const r = await runInteractiveVerify({
      tool: "shell",
      script: "echo something-else",
      expect: "needle",
    });
    expect(r.met).toBe(false);
    expect(r.evidence).toContain("not found");
  });

  it("kills script that exceeds timeout", async () => {
    const r = await runInteractiveVerify({
      tool: "shell",
      script: "sleep 5 && echo done",
      timeoutMs: 200,
    });
    expect(r.met).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(r.stdoutTail).toContain("[killed: timeout]");
  });

  it("does NOT false-negative a clean run on an unmatched PROSE expect (regression)", async () => {
    // The bug: a sentence-form expect could never substring-match TAP output, so a
    // genuinely-passing probe flipped to met=false (failureCategory interactive-failure).
    const r = await runInteractiveVerify({
      tool: "shell",
      script: "echo '# tests 77'; echo '# pass 77'; echo '# fail 0'; echo EXIT=0",
      expect: "EXIT=0 with no failing tests and at least 11 passing (original suite intact)",
    });
    expect(r.met).toBe(true);
  });
});

// Regression for the interactive-probe false-negative observed on a real rollup
// verdict: a model-authored natural-language `expect` was required verbatim in
// stdout, so every passing "command should succeed" probe flipped to met=false
// with failureCategory "interactive-failure" (rollup-tests-green/typecheck-clean).
describe("evaluateExpect — the false-negative fix", () => {
  it("does NOT veto a clean run on an unmatched PROSE expect (the bug)", () => {
    const out = "TAP version 13\nok 1 - a\n# tests 77\n# pass 77\n# fail 0\n";
    const prose = "EXIT=0 with no failing tests and at least 11 passing (original suite intact)";
    expect(evaluateExpect(prose, out, 0).met).toBe(true);
  });

  it("trusts an echoed EXIT=0 sentinel even when the real process exit is masked to 0", () => {
    const out = "EXIT=0\n";
    const prose = "EXIT=0 (no type errors; verbatimModuleSyntax + erasable syntax satisfied)";
    expect(evaluateExpect(prose, out, 0).met).toBe(true);
  });

  it("fails when an echoed EXIT sentinel is non-zero (the `; echo EXIT=$?` masking case)", () => {
    const out = "src/x.ts(1,1): error TS2304\nEXIT=2\n";
    expect(evaluateExpect("EXIT=0 clean typecheck please", out, 0).met).toBe(false);
  });

  it("fails on a real non-zero exit when no EXIT sentinel was echoed", () => {
    expect(evaluateExpect("the tests pass", "# fail 3\n", 1).met).toBe(false);
  });

  it("vetoes when a SALIENT token the expect demanded is absent (anti-gaming preserved)", () => {
    const out = "# tests 5\n# pass 2\n# fail 3\nEXIT=0\n";
    expect(evaluateExpect('expect "# fail 0" — all green', out, 0).met).toBe(false);
  });

  it("passes when the demanded salient token IS present", () => {
    const out = "# tests 5\n# pass 5\n# fail 0\nEXIT=0\n";
    expect(evaluateExpect('expect "# fail 0" — all green', out, 0).met).toBe(true);
  });

  it("still fails a short literal sentinel that is absent (legitimate literal case)", () => {
    expect(evaluateExpect("PROBE_OK", "something-else\n", 0).met).toBe(false);
  });

  it("absent expect → driven purely by exit code", () => {
    expect(evaluateExpect(undefined, "whatever", 0).met).toBe(true);
    expect(evaluateExpect(undefined, "whatever", 1).met).toBe(false);
  });
});

describe("extractSalientTokens", () => {
  it("pulls TAP counters and ok/not-ok lines, leaving EXIT to the mechanical check", () => {
    const toks = extractSalientTokens("EXIT=0 with # fail 0, # pass 12, ok 5 and not ok 7");
    expect(toks).toContain("# fail 0");
    expect(toks).toContain("# pass 12");
    expect(toks).toContain("ok 5");
    expect(toks).toContain("not ok 7");
    expect(toks.some((t) => t.includes("EXIT"))).toBe(false);
  });

  it("pulls quoted and backticked literals", () => {
    const toks = extractSalientTokens('expect "resolved at rung 2" and `share 0`');
    expect(toks).toContain("resolved at rung 2");
    expect(toks).toContain("share 0");
  });

  it("returns nothing for pure prose with no checkable token", () => {
    expect(extractSalientTokens("the build should be clean and correct")).toEqual([]);
  });
});
