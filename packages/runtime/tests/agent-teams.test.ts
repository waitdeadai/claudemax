import { describe, expect, it } from "vitest";
import { runAgentTeams, type SpawnTeammateOptions } from "../src/agent-teams.js";
import type { MultiSpec, Spec } from "@claudemax/core";

const makeSpec = (title: string): Spec => ({
  title,
  goal: `Goal for ${title}`,
  completionConditions: [{ id: `${title}-cc-1`, description: `cc for ${title}` }],
});

const PACKET_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("agent-teams — true parallel dispatch (post-Obs-7 fix)", () => {
  it("runs N=4 independent leaves concurrently, wall-clock < sum of packet durations", async () => {
    const multispec: MultiSpec = {
      rootGoal: "parallelism smoke",
      subSpecs: [makeSpec("Alpha"), makeSpec("Beta"), makeSpec("Gamma"), makeSpec("Delta")],
      dependencies: [],
      rollupCompletionConditions: [],
    };
    const stateDir = `/tmp/cmax-test-parallel-${Date.now()}`;
    const fakeSpawn = async (_o: SpawnTeammateOptions): Promise<"finished"> => {
      await sleep(PACKET_MS);
      return "finished";
    };

    const t0 = Date.now();
    const result = await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir,
      _spawnTeammate: fakeSpawn,
      maxParallel: 4,
    });
    const wallClockMs = Date.now() - t0;

    const sumMs = multispec.subSpecs.length * PACKET_MS;
    expect(wallClockMs).toBeLessThan(sumMs);
    expect(wallClockMs).toBeGreaterThanOrEqual(PACKET_MS - 50);
    expect(Object.values(result.perSubSpec).every((s) => s === "finished")).toBe(true);
    expect(Object.keys(result.perSubSpec)).toHaveLength(4);
  });

  it("respects multispec.dependencies DAG: dependent sub-Spec starts after its dep finishes", async () => {
    const multispec: MultiSpec = {
      rootGoal: "dag enforcement",
      subSpecs: [makeSpec("Root"), makeSpec("Leaf")],
      dependencies: [{ from: "leaf", to: "root" }],
      rollupCompletionConditions: [],
    };
    const stateDir = `/tmp/cmax-test-dag-${Date.now()}`;
    const startedAt: Record<string, number> = {};
    const fakeSpawn = async (o: SpawnTeammateOptions): Promise<"finished"> => {
      startedAt[o.subSpecId] = Date.now();
      await sleep(PACKET_MS);
      return "finished";
    };

    await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir,
      _spawnTeammate: fakeSpawn,
      maxParallel: 4,
    });

    expect(startedAt.leaf - startedAt.root).toBeGreaterThanOrEqual(PACKET_MS - 50);
  });

  it("bounds concurrency at maxParallel=2 even when 4 leaves are ready", async () => {
    const multispec: MultiSpec = {
      rootGoal: "concurrency cap",
      subSpecs: [makeSpec("A"), makeSpec("B"), makeSpec("C"), makeSpec("D")],
      dependencies: [],
      rollupCompletionConditions: [],
    };
    const stateDir = `/tmp/cmax-test-cap-${Date.now()}`;
    let concurrentNow = 0;
    let concurrentPeak = 0;
    const fakeSpawn = async (_o: SpawnTeammateOptions): Promise<"finished"> => {
      concurrentNow += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrentNow);
      await sleep(PACKET_MS);
      concurrentNow -= 1;
      return "finished";
    };

    await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir,
      _spawnTeammate: fakeSpawn,
      maxParallel: 2,
    });

    expect(concurrentPeak).toBe(2);
  });

  it("marks unreachable sub-Specs failed when dependency cycle is present", async () => {
    const multispec: MultiSpec = {
      rootGoal: "cycle handling",
      subSpecs: [makeSpec("X"), makeSpec("Y")],
      dependencies: [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
      ],
      rollupCompletionConditions: [],
    };
    const stateDir = `/tmp/cmax-test-cycle-${Date.now()}`;
    const fakeSpawn = async (_o: SpawnTeammateOptions): Promise<"finished"> => {
      return "finished";
    };

    const result = await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir,
      _spawnTeammate: fakeSpawn,
    });

    expect(Object.values(result.perSubSpec)).toEqual(["failed", "failed"]);
  });
});
