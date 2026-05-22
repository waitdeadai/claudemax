import { describe, expect, it } from "vitest";
import {
  aggregateVerdict,
  buildGoalRunArgs,
  mapExitCodeToStatus,
  planGoals,
  slugifyGoal,
  type GoalRunRecord,
} from "../src/orchestrator-multi.js";

describe("slugifyGoal", () => {
  it("lowercases, replaces non-alphanumerics with single dash, trims", () => {
    expect(slugifyGoal("Add a /health endpoint with tests!")).toBe("add-a-health-endpoint-with-tests");
  });

  it("truncates to 40 chars", () => {
    const long = "x".repeat(200);
    expect(slugifyGoal(long).length).toBe(40);
  });

  it("falls back to the supplied default for fully non-alphanumeric input", () => {
    expect(slugifyGoal("!!! ???", "default-slug")).toBe("default-slug");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyGoal("---hello---")).toBe("hello");
  });
});

describe("planGoals", () => {
  it("returns one GoalSpec per non-empty input", () => {
    const goals = planGoals(["add health", "migrate user", ""], "/tmp/x");
    expect(goals).toHaveLength(2);
    expect(goals[0]?.id).toBe("add-health");
    expect(goals[0]?.cwd).toBe("/tmp/x");
  });

  it("deduplicates colliding slugs by suffixing", () => {
    const goals = planGoals(["add a thing", "add a thing!", "add a thing??"], "/tmp/x");
    expect(goals.map((g) => g.id)).toEqual(["add-a-thing", "add-a-thing-2", "add-a-thing-3"]);
  });

  it("trims whitespace from input goals", () => {
    const goals = planGoals(["  goal A  "], "/tmp/x");
    expect(goals[0]?.goal).toBe("goal A");
  });
});

describe("aggregateVerdict", () => {
  const rec = (status: GoalRunRecord["status"]): GoalRunRecord => ({
    id: "g",
    goal: "g",
    cwd: "/tmp",
    status,
    startedAt: 0,
    stdoutTail: "",
    stderrTail: "",
  });

  it("empty input → all-failed", () => {
    expect(aggregateVerdict([])).toBe("all-failed");
  });

  it("every record finished → all-finished", () => {
    expect(aggregateVerdict([rec("finished"), rec("finished")])).toBe("all-finished");
  });

  it("every record failed or blocked → all-failed", () => {
    expect(aggregateVerdict([rec("failed"), rec("blocked")])).toBe("all-failed");
  });

  it("mix of finished + non-finished → partial", () => {
    expect(aggregateVerdict([rec("finished"), rec("partial")])).toBe("partial");
    expect(aggregateVerdict([rec("finished"), rec("failed")])).toBe("partial");
  });
});

describe("buildGoalRunArgs — SPEC.md write-race fix", () => {
  it("gives each goal its own --out path under the orchestrator state dir", () => {
    const a = buildGoalRunArgs({ id: "goal-a", goal: "do a", cwd: "/tmp" }, {}, "/tmp/state");
    const b = buildGoalRunArgs({ id: "goal-b", goal: "do b", cwd: "/tmp" }, {}, "/tmp/state");
    expect(a[a.indexOf("--out") + 1]).toBe("/tmp/state/goal-a.SPEC.md");
    expect(b[b.indexOf("--out") + 1]).toBe("/tmp/state/goal-b.SPEC.md");
    expect(a[a.indexOf("--out") + 1]).not.toBe(b[b.indexOf("--out") + 1]);
  });

  it("--out path is distinct from --memory path for the same goal", () => {
    const a = buildGoalRunArgs({ id: "goal-a", goal: "do a", cwd: "/tmp" }, {}, "/tmp/state");
    const outPath = a[a.indexOf("--out") + 1];
    const memPath = a[a.indexOf("--memory") + 1];
    expect(outPath).not.toBe(memPath);
    expect(outPath?.endsWith(".SPEC.md")).toBe(true);
    expect(memPath?.endsWith(".memory.sqlite")).toBe(true);
  });

  it("propagates --tdd / --confidence / --variant / --mode when set", () => {
    const args = buildGoalRunArgs(
      { id: "g", goal: "x", cwd: "/tmp" },
      { tdd: true, confidence: 0.85, variant: "opusolo", mode: "solo" },
      "/tmp/state",
    );
    expect(args).toContain("--tdd");
    expect(args).toContain("--confidence");
    expect(args[args.indexOf("--confidence") + 1]).toBe("0.85");
    expect(args).toContain("--variant");
    expect(args[args.indexOf("--variant") + 1]).toBe("opusolo");
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("solo");
  });
});

describe("mapExitCodeToStatus", () => {
  it("exit 0 → finished regardless of stdout", () => {
    expect(mapExitCodeToStatus(0, "")).toBe("finished");
    expect(mapExitCodeToStatus(0, "anything")).toBe("finished");
  });

  it("non-zero exit + ✗ partial marker → partial", () => {
    expect(mapExitCodeToStatus(1, "lots of output\n\n✗ partial\n")).toBe("partial");
  });

  it("non-zero exit + ✗ failed marker → failed", () => {
    expect(mapExitCodeToStatus(1, "lots of output\n\n✗ failed\n")).toBe("failed");
  });

  it("null exit code (spawn error / killed) → blocked", () => {
    expect(mapExitCodeToStatus(null, "")).toBe("blocked");
  });

  it("non-zero exit with no marker → failed", () => {
    expect(mapExitCodeToStatus(1, "no markers here")).toBe("failed");
  });
});
