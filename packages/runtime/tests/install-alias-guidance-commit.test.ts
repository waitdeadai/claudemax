import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");

const REQUIRED_SUBJECT =
  "install: surface dangerously-skip-permissions alias guidance at install end";

function git(args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}

describe("HEAD commit gates the dangerously-skip-permissions alias-guidance surfacing", () => {
  it("HEAD subject matches the required message exactly", () => {
    const subject = git(["log", "-1", "--pretty=%s"]).trim();
    expect(subject).toBe(REQUIRED_SUBJECT);
  });

  it("HEAD modifies exactly install.sh and install.ps1, no other files", () => {
    const raw = git(["show", "--name-only", "--pretty=format:", "HEAD"]);
    const files = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .sort();
    expect(files).toEqual(["install.ps1", "install.sh"]);
  });
});
