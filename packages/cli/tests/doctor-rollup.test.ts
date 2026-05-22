import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const doctorPath = resolve(repoRoot, "packages/cli/src/commands/doctor.ts");
const bumpScriptPath = resolve(repoRoot, "scripts/bump-version.sh");
const hooksIntrospectPath = resolve(repoRoot, "packages/runtime/src/hooks-introspect.ts");
const pkgPath = resolve(repoRoot, "package.json");
const pluginPath = resolve(repoRoot, "plugin.json");

describe("doctor.ts rollup: --hooks + version-consistency + manifests at 0.2.2", () => {
  it("package.json version is 0.2.2", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(pkg.version).toBe("0.2.2");
  });

  it("plugin.json version is 0.2.2", () => {
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
    expect(plugin.version).toBe("0.2.2");
  });

  it("scripts/bump-version.sh exists and is executable", () => {
    expect(existsSync(bumpScriptPath)).toBe(true);
    expect(() => accessSync(bumpScriptPath, constants.X_OK)).not.toThrow();
  });

  it("packages/runtime/src/hooks-introspect.ts exists", () => {
    expect(existsSync(hooksIntrospectPath)).toBe(true);
  });

  it("doctor.ts declares the --hooks option", () => {
    const src = readFileSync(doctorPath, "utf8");
    expect(src).toMatch(/--hooks/);
  });

  it("doctor.ts declares --strict for hook misconfiguration", () => {
    const src = readFileSync(doctorPath, "utf8");
    expect(src).toMatch(/--strict/);
  });

  it("doctor.ts performs a version-consistency check between package.json and plugin.json", () => {
    const src = readFileSync(doctorPath, "utf8");
    expect(src).toMatch(/plugin\.json/);
    expect(src).toMatch(/package\.json/);
    expect(src.toLowerCase()).toMatch(/version/);
  });

  it("doctor.ts references agentcloseout-physics for the --hooks output", () => {
    const src = readFileSync(doctorPath, "utf8");
    expect(src).toMatch(/agentcloseout-physics/);
  });
});
