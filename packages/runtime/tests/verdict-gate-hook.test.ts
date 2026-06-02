import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// packages/runtime/tests/<file> → repo root is three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATE = join(repoRoot, ".claude", "hooks", "cmax-verdict-gate.sh");
const STUB = join(repoRoot, ".claude", "hooks", "cmax-stub-gate.sh");

function runHook(script: string, payload: object, env: Record<string, string> = {}): number {
  try {
    execFileSync("bash", [script], {
      input: JSON.stringify(payload),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

function stateWith(verdictPass: boolean | null, hash = "abc123def4567890"): string {
  const cwd = mkdtempSync(join(tmpdir(), "cmax-gate-"));
  const dir = join(cwd, ".claudemax", "state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "active-run.json"),
    JSON.stringify({ specHash: hash, title: "t", startedAt: "2026-01-01T00:00:00.000Z" }),
  );
  if (verdictPass !== null) {
    writeFileSync(
      join(dir, `verdict-${hash}.json`),
      JSON.stringify({
        schema: "cmax.verdict.v1",
        specHash: hash,
        title: "t",
        gate: { pass: verdictPass, reasons: verdictPass ? [] : ['condition "cc-1" not met'] },
      }),
    );
  }
  return cwd;
}

describe("cmax-verdict-gate.sh (completion gate — Frente C.1)", () => {
  it("no-ops (exit 0) when there is no active-run sentinel", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmax-gate-"));
    expect(runHook(GATE, { hook_event_name: "Stop", cwd })).toBe(0);
  });

  it("no-ops when the verdict for the active run is not yet on disk (don't trap in-flight sub-sessions)", () => {
    const cwd = stateWith(null);
    expect(runHook(GATE, { hook_event_name: "Stop", cwd })).toBe(0);
  });

  it("allows the stop (exit 0) when the verdict gate passed", () => {
    const cwd = stateWith(true);
    expect(runHook(GATE, { hook_event_name: "Stop", cwd })).toBe(0);
  });

  it("BLOCKS (exit 2) when the verdict exists and the gate failed", () => {
    const cwd = stateWith(false);
    expect(runHook(GATE, { hook_event_name: "Stop", cwd })).toBe(2);
  });

  it("escape hatch CMAX_VERDICT_GATE_OFF=1 forces exit 0 even on a failing verdict", () => {
    const cwd = stateWith(false);
    expect(runHook(GATE, { hook_event_name: "Stop", cwd }, { CMAX_VERDICT_GATE_OFF: "1" })).toBe(0);
  });
});

describe("cmax-stub-gate.sh (deterministic stub gate — §2-bis)", () => {
  it("BLOCKS a Write that adds a TODO to production source", () => {
    expect(
      runHook(STUB, {
        tool_name: "Write",
        tool_input: { file_path: "src/foo.ts", content: "export const x = 1; // TODO: finish" },
      }),
    ).toBe(2);
  });

  it("BLOCKS a Write containing NotImplementedError", () => {
    expect(
      runHook(STUB, {
        tool_name: "Write",
        tool_input: { file_path: "src/svc.py", content: "def f():\n    raise NotImplementedError" },
      }),
    ).toBe(2);
  });

  it("allows a clean production write", () => {
    expect(
      runHook(STUB, {
        tool_name: "Write",
        tool_input: { file_path: "src/foo.ts", content: "export const x = 1;\n" },
      }),
    ).toBe(0);
  });

  it("skips test files (TODO/mock legitimate in tests)", () => {
    expect(
      runHook(STUB, {
        tool_name: "Write",
        tool_input: { file_path: "src/foo.test.ts", content: "// TODO later\nvi.mock('x')" },
      }),
    ).toBe(0);
  });

  it("honors cmax-allow on the offending line", () => {
    expect(
      runHook(STUB, {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts", new_string: "x(); // TODO tracked elsewhere cmax-allow" },
      }),
    ).toBe(0);
  });

  it("flags a MultiEdit whose edits introduce a stub", () => {
    expect(
      runHook(STUB, {
        tool_name: "MultiEdit",
        tool_input: { file_path: "src/foo.ts", edits: [{ new_string: "const y = 2;" }, { new_string: "// FIXME wire this" }] },
      }),
    ).toBe(2);
  });

  it("escape hatch CMAX_STUB_GATE_OFF=1 forces exit 0", () => {
    expect(
      runHook(
        STUB,
        { tool_name: "Write", tool_input: { file_path: "src/foo.ts", content: "// FIXME" } },
        { CMAX_STUB_GATE_OFF: "1" },
      ),
    ).toBe(0);
  });
});
