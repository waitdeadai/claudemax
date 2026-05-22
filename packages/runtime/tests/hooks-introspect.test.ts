import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectMisconfiguredHook,
  probeAgentcloseoutPhysics,
  readHookSources,
} from "../src/hooks-introspect.js";

function freshDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cmax-hooks-introspect-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("hooks-introspect", () => {
  it("readHookSources silently skips files that don't exist", () => {
    const entries = readHookSources({
      userPath: "/definitely/not/a/real/path/user.json",
      repoPath: "/definitely/not/a/real/path/repo.json",
    });
    expect(entries).toEqual([]);
  });

  it("readHookSources normalizes entries across the 9 named events", () => {
    const { dir, cleanup } = freshDir();
    try {
      const userSettingsDir = join(dir, "user", ".claude");
      const repoSettingsDir = join(dir, "repo", ".claude");
      mkdirSync(userSettingsDir, { recursive: true });
      mkdirSync(repoSettingsDir, { recursive: true });
      const userPath = join(userSettingsDir, "settings.json");
      const repoPath = join(repoSettingsDir, "settings.json");
      writeFileSync(
        userPath,
        JSON.stringify({
          hooks: {
            Stop: [
              { matcher: "*", hooks: [{ type: "command", command: "echo stop" }] },
            ],
            SessionStart: [
              { hooks: [{ type: "command", command: "echo session" }] },
            ],
          },
        }),
      );
      writeFileSync(
        repoPath,
        JSON.stringify({
          hooks: {
            PostToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "echo bash" }] },
            ],
            PreToolUse: [
              { matcher: "Edit", hooks: [{ type: "command", command: "echo edit" }] },
            ],
            UserPromptSubmit: [
              { hooks: [{ type: "command", command: "echo submit" }] },
            ],
            SubagentStop: [
              { hooks: [{ type: "command", command: "echo sub" }] },
            ],
            PreCompact: [
              { hooks: [{ type: "command", command: "echo precompact" }] },
            ],
            PostCompact: [
              { hooks: [{ type: "command", command: "echo postcompact" }] },
            ],
            Notification: [
              { hooks: [{ type: "command", command: "echo notif" }] },
            ],
          },
        }),
      );
      const entries = readHookSources({ userPath, repoPath });
      const events = entries.map((e) => e.event).sort();
      expect(events).toEqual(
        [
          "Notification",
          "PostToolUse",
          "PreCompact",
          "PostCompact",
          "PreToolUse",
          "SessionStart",
          "Stop",
          "SubagentStop",
          "UserPromptSubmit",
        ].sort(),
      );
      const stop = entries.find((e) => e.event === "Stop")!;
      expect(stop.source).toBe(userPath);
      expect(stop.matcher).toBe("*");
      expect(stop.handler.type).toBe("command");
      const bash = entries.find((e) => e.event === "PostToolUse")!;
      expect(bash.source).toBe(repoPath);
      expect(bash.matcher).toBe("Bash");
    } finally {
      cleanup();
    }
  });

  it("detectMisconfiguredHook returns reason when type is missing", () => {
    const reason = detectMisconfiguredHook({ command: "echo x" });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/type/i);
  });

  it("detectMisconfiguredHook returns reason when type=command but no command", () => {
    const reason = detectMisconfiguredHook({ type: "command" });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/command/i);
  });

  it("detectMisconfiguredHook returns reason when type=http but no url", () => {
    const reason = detectMisconfiguredHook({ type: "http" });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/url/i);
  });

  it("detectMisconfiguredHook returns null for valid command hook", () => {
    expect(detectMisconfiguredHook({ type: "command", command: "echo hi" })).toBeNull();
  });

  it("detectMisconfiguredHook returns null for valid http hook", () => {
    expect(detectMisconfiguredHook({ type: "http", url: "https://example/hook" })).toBeNull();
  });

  it("probeAgentcloseoutPhysics returns {path, version} shape (nullable)", () => {
    const r = probeAgentcloseoutPhysics();
    expect(r).toHaveProperty("path");
    expect(r).toHaveProperty("version");
    expect(r.path === null || typeof r.path === "string").toBe(true);
    expect(r.version === null || typeof r.version === "string").toBe(true);
  });
});
