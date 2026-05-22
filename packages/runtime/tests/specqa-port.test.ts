import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const MSG = "skills: port /specqa spec quality gate from minmaxing v1";

function gitOk(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

describe("/specqa port — SPEC completion conditions", () => {
  it("cc-commit-message-present: git log contains the canonical /specqa commit", () => {
    const r = gitOk(["log", "--oneline"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(MSG);
  });

  it("cc-commit-touched-skillmd: the /specqa commit touched skills/specqa/SKILL.md", () => {
    const r = gitOk([
      "log",
      "--name-only",
      "--pretty=format:",
      "-1",
      `--grep=${MSG}`,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.split(/\r?\n/)).toContain("skills/specqa/SKILL.md");
  });

  it("cc-worktree-clean-for-paths: no uncommitted changes to in-scope paths", () => {
    const r = gitOk([
      "status",
      "--porcelain",
      "skills/specqa/",
      "docs/SKILL_CATALOG.md",
      "skills/README.md",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
