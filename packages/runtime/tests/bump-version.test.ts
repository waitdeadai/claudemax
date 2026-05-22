import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const scriptPath = join(repoRoot, "scripts", "bump-version.sh");

describe("scripts/bump-version.sh", () => {
  it("exists and is executable", () => {
    expect(() => accessSync(scriptPath, constants.X_OK)).not.toThrow();
  });

  it("declares bash shebang and set -euo pipefail", () => {
    const text = readFileSync(scriptPath, "utf8");
    const head = text.split("\n").slice(0, 3).join("\n");
    expect(head).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(text).toMatch(/set -euo pipefail/);
  });

  it("exits non-zero when given a non-SemVer argument", () => {
    const r = spawnSync("bash", [scriptPath, "not-a-version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
  });

  it("accepts valid SemVer and atomically updates both manifests", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "bump-version-"));
    try {
      const pkg = join(sandbox, "package.json");
      const plugin = join(sandbox, "plugin.json");
      writeFileSync(pkg, JSON.stringify({ name: "demo", version: "0.0.1" }, null, 2));
      writeFileSync(plugin, JSON.stringify({ name: "demo-plugin", version: "0.0.1" }, null, 2));
      copyFileSync(scriptPath, join(sandbox, "bump-version.sh"));
      const r = spawnSync("bash", [join(sandbox, "bump-version.sh"), "1.2.3"], {
        cwd: sandbox,
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      const pkgJson = JSON.parse(readFileSync(pkg, "utf8"));
      const pluginJson = JSON.parse(readFileSync(plugin, "utf8"));
      expect(pkgJson.version).toBe("1.2.3");
      expect(pluginJson.version).toBe("1.2.3");
      expect(r.stdout).toMatch(/package\.json/);
      expect(r.stdout).toMatch(/plugin\.json/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects empty string and prerelease without minor", () => {
    const empty = spawnSync("bash", [scriptPath, ""], { cwd: repoRoot, encoding: "utf8" });
    expect(empty.status).not.toBe(0);
    const badPre = spawnSync("bash", [scriptPath, "1.2"], { cwd: repoRoot, encoding: "utf8" });
    expect(badPre.status).not.toBe(0);
  });
});
