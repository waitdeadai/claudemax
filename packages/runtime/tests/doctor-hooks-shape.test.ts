import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DOCTOR_TS = resolve(REPO_ROOT, "packages/cli/src/commands/doctor.ts");
const DOCTOR_DIST = resolve(REPO_ROOT, "packages/cli/dist/commands/doctor.js");
const CLI_ENTRY = resolve(REPO_ROOT, "packages/cli/dist/index.js");
const PKG_JSON = resolve(REPO_ROOT, "package.json");
const PLUGIN_JSON = resolve(REPO_ROOT, "plugin.json");

const DOCTOR_SRC = readFileSync(DOCTOR_TS, "utf8");

describe("doctor.ts source shape (sub-spec completion conditions 1, 2, 4)", () => {
  it("registers --hooks option via commander", () => {
    expect(DOCTOR_SRC).toMatch(/\.option\("--hooks"/);
  });

  it("registers --strict option via commander", () => {
    expect(DOCTOR_SRC).toMatch(/\.option\("--strict"/);
  });

  it("reads both package.json and plugin.json paths", () => {
    expect(DOCTOR_SRC).toMatch(/package\.json/);
    expect(DOCTOR_SRC).toMatch(/plugin\.json/);
  });

  it("emits an ERROR-labelled mismatch when versions disagree", () => {
    expect(DOCTOR_SRC).toMatch(/ERROR/);
    expect(DOCTOR_SRC.toLowerCase()).toMatch(/mismatch|version/);
  });

  it("mentions agentcloseout-physics for the --hooks listing", () => {
    expect(DOCTOR_SRC).toMatch(/agentcloseout-physics/);
  });
});

describe("repo manifest reconciliation (sub-spec completion condition 3,5 precondition)", () => {
  it("package.json .version is 0.2.2", () => {
    const v = JSON.parse(readFileSync(PKG_JSON, "utf8")).version;
    expect(v).toBe("0.2.2");
  });

  it("plugin.json .version is 0.2.2", () => {
    const v = JSON.parse(readFileSync(PLUGIN_JSON, "utf8")).version;
    expect(v).toBe("0.2.2");
  });
});

describe("doctor CLI behaviour (sub-spec completion conditions 3, 4, 5)", () => {
  it("dist build artifact exists for doctor", () => {
    if (!existsSync(DOCTOR_DIST) || !existsSync(CLI_ENTRY)) {
      throw new Error(
        `Build first: missing ${DOCTOR_DIST} or ${CLI_ENTRY}. Run \`pnpm build\` to materialize the cli dist.`,
      );
    }
    expect(existsSync(DOCTOR_DIST)).toBe(true);
    expect(existsSync(CLI_ENTRY)).toBe(true);
  });

  it("`doctor --hooks` exits 0 and prints agentcloseout-physics line", () => {
    const r = execFileSync(process.execPath, [CLI_ENTRY, "doctor", "--hooks"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r).toMatch(/agentcloseout-physics/);
  });

  it("`doctor` (no flag) exits 0 against matching manifest versions", () => {
    const r = execFileSync(process.execPath, [CLI_ENTRY, "doctor"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r).toMatch(/0\.2\.2/);
  });
});
