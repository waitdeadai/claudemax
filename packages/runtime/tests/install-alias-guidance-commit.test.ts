import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");

const REQUIRED_SUBJECT =
  "install: surface dangerously-skip-permissions alias guidance at install end";

function git(args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}

describe("commit gates the dangerously-skip-permissions alias-guidance surfacing", () => {
  it("git log contains a commit with the required subject", () => {
    const log = git(["log", "--pretty=%s"]).trim();
    expect(log.split("\n")).toContain(REQUIRED_SUBJECT);
  });

  it("the alias-guidance commit modifies exactly install.sh and install.ps1", () => {
    const sha = git(["log", "--pretty=%H", `--grep=${REQUIRED_SUBJECT}`])
      .trim()
      .split("\n")[0];
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
    const raw = git(["show", "--name-only", "--pretty=format:", sha]);
    const files = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .sort();
    expect(files).toEqual(["install.ps1", "install.sh"]);
  });
});
