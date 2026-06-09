import { describe, expect, it, vi } from "vitest";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  evaluatePreservationGate,
  inferSimplifyTestCommand,
  isTestPath,
  runSimplifyPass,
  type Shell,
} from "./simplify.js";

function asyncIter<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

const noopQuery = vi.fn(() => asyncIter([])) as unknown as typeof sdkQuery;

interface Resp {
  readonly code: number;
  readonly stdout?: string;
}

// FIFO-per-key scripted shell: keyed by the full `cmd arg arg` line, each key's
// queue is consumed in order so the same command (e.g. `git stash create`) can
// return different values on successive rounds. Records every call for asserts.
function scriptedShell(
  script: Record<string, readonly Resp[]>,
): { sh: Shell; calls: string[] } {
  const counters: Record<string, number> = {};
  const calls: string[] = [];
  const sh: Shell = (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    const q = script[key];
    if (q && q.length > 0) {
      const i = counters[key] ?? 0;
      counters[key] = i + 1;
      const r = q[Math.min(i, q.length - 1)];
      return { code: r.code, stdout: r.stdout ?? "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { sh, calls };
}

const TEST_CMD = "pnpm test --passWithNoTests";
const BASH_KEY = `bash -lc ${TEST_CMD}`;

describe("evaluatePreservationGate — the SOTA behavior-preservation rule", () => {
  it("skips when there is no green baseline (no oracle)", () => {
    expect(evaluatePreservationGate({ baselineGreen: false, postGreen: true, testFilesTouched: false })).toBe("skip-no-baseline");
    expect(evaluatePreservationGate({ baselineGreen: false, postGreen: false, testFilesTouched: true })).toBe("skip-no-baseline");
  });

  it("reverts when a test file was touched, EVEN if the suite is green (tests-modified = behavior changed)", () => {
    expect(evaluatePreservationGate({ baselineGreen: true, postGreen: true, testFilesTouched: true })).toBe("revert");
  });

  it("reverts when the suite goes red", () => {
    expect(evaluatePreservationGate({ baselineGreen: true, postGreen: false, testFilesTouched: false })).toBe("revert");
  });

  it("accepts only when the suite stays green with no test edits", () => {
    expect(evaluatePreservationGate({ baselineGreen: true, postGreen: true, testFilesTouched: false })).toBe("accept");
  });
});

describe("isTestPath", () => {
  it("classifies real test paths", () => {
    for (const p of ["src/foo.test.ts", "a/b.spec.tsx", "__tests__/x.js", "tests/y.py", "test/z.rb", "pkg/foo_test.go", "test_widget.py"]) {
      expect(isTestPath(p)).toBe(true);
    }
  });
  it("does not flag production files that merely contain the substring", () => {
    for (const p of ["src/foo.ts", "lib/spectrum.ts", "src/description.ts", "app/contest.ts", "src/latest.ts"]) {
      expect(isTestPath(p)).toBe(false);
    }
  });
});

describe("inferSimplifyTestCommand", () => {
  it("defaults to a no-tests-tolerant pnpm test when none given", () => {
    expect(inferSimplifyTestCommand(undefined)).toBe("pnpm test --passWithNoTests");
    expect(inferSimplifyTestCommand("  ")).toBe("pnpm test --passWithNoTests");
  });
  it("passes a provided command through, trimmed", () => {
    expect(inferSimplifyTestCommand("  pytest -q  ")).toBe("pytest -q");
  });
});

describe("runSimplifyPass — integration over an injected shell + query", () => {
  it("skips when the cwd is not a git work tree (cannot snapshot to revert)", async () => {
    const { sh } = scriptedShell({ "git rev-parse --is-inside-work-tree": [{ code: 1 }] });
    const r = await runSimplifyPass({ queryFn: noopQuery, sh });
    expect(r.status).toBe("skipped");
    expect(r.oracle).toBe("none");
  });

  it("skips when the baseline suite is not green (no behavior oracle)", async () => {
    const { sh } = scriptedShell({
      "git rev-parse --is-inside-work-tree": [{ code: 0 }],
      [BASH_KEY]: [{ code: 1 }],
    });
    const r = await runSimplifyPass({ queryFn: noopQuery, sh });
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/baseline/i);
  });

  it("applies a round that keeps the suite green with no test edits", async () => {
    const { sh } = scriptedShell({
      "git rev-parse --is-inside-work-tree": [{ code: 0 }],
      [BASH_KEY]: [{ code: 0 }],
      "git stash create": [{ code: 0, stdout: "snap1\n" }, { code: 0, stdout: "snap2\n" }],
      "git ls-files --others --exclude-standard": [{ code: 0, stdout: "" }],
      "git diff --name-only snap1": [{ code: 0, stdout: "src/foo.ts\n" }],
      "git diff --name-only snap2": [{ code: 0, stdout: "" }],
    });
    const r = await runSimplifyPass({ queryFn: noopQuery, sh, maxRounds: 2 });
    expect(r.status).toBe("applied");
    expect(r.rounds).toBe(1);
    expect(r.oracle).toBe("tests");
  });

  it("reverts a round that modifies a test file, even though the suite is green", async () => {
    const { sh, calls } = scriptedShell({
      "git rev-parse --is-inside-work-tree": [{ code: 0 }],
      [BASH_KEY]: [{ code: 0 }],
      "git stash create": [{ code: 0, stdout: "snap1\n" }],
      "git ls-files --others --exclude-standard": [{ code: 0, stdout: "" }],
      "git diff --name-only snap1": [{ code: 0, stdout: "src/foo.test.ts\n" }],
    });
    const r = await runSimplifyPass({ queryFn: noopQuery, sh, maxRounds: 2 });
    expect(r.status).toBe("reverted");
    expect(r.rounds).toBe(0);
    expect(calls).toContain("git checkout snap1 -- .");
  });

  it("reports noop when the first round changes nothing", async () => {
    const { sh } = scriptedShell({
      "git rev-parse --is-inside-work-tree": [{ code: 0 }],
      [BASH_KEY]: [{ code: 0 }],
      "git stash create": [{ code: 0, stdout: "snap1\n" }],
      "git ls-files --others --exclude-standard": [{ code: 0, stdout: "" }],
      "git diff --name-only snap1": [{ code: 0, stdout: "" }],
    });
    const r = await runSimplifyPass({ queryFn: noopQuery, sh, maxRounds: 2 });
    expect(r.status).toBe("noop");
    expect(r.rounds).toBe(0);
  });
});
