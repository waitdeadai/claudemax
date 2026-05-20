import { describe, expect, it } from "vitest";
import { runInteractiveVerify } from "../src/interactive-verify.js";

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
});
