import { describe, expect, it } from "vitest";
import { execModelForVariant, MODELS, type MultiSpec, type Spec } from "@claudemax/core";
import { runAgentTeams, type SpawnTeammateOptions } from "../src/agent-teams.js";

// Regression guard for the opussonnet/opusolo model-routing fix (2026-05-25).
// Before this, --variant was cosmetic: sub-Spec execution was hardcoded to Opus
// regardless of variant. These tests pin the routing decision + the teams-mode
// model threading so it cannot silently regress again.

const makeSpec = (title: string): Spec => ({
  title,
  goal: `Goal for ${title}`,
  nonGoals: [],
  constraints: [],
  completionConditions: [{ id: `${title}-cc-1`, description: "cc", verifyHint: "echo ok" }],
  assumptions: [],
  evidenceRequired: [],
  createdAt: new Date().toISOString(),
});

describe("execModelForVariant — the routing decision", () => {
  it("opussonnet routes sub-Spec execution to Sonnet", () => {
    expect(execModelForVariant("opussonnet")).toBe(MODELS.sonnet.id);
    expect(execModelForVariant("opussonnet")).toBe("claude-sonnet-4-6");
  });

  it("opusolo routes sub-Spec execution to Opus", () => {
    expect(execModelForVariant("opusolo")).toBe(MODELS.opus.id);
    expect(execModelForVariant("opusolo")).toBe("claude-opus-4-7");
  });

  it("the two variants resolve to different models (not cosmetic)", () => {
    expect(execModelForVariant("opussonnet")).not.toBe(execModelForVariant("opusolo"));
  });
});

describe("runAgentTeams — threads the exec model to each teammate", () => {
  it("passes opts.model into every spawned teammate (Sonnet for opussonnet)", async () => {
    const seen: Array<string | undefined> = [];
    const fakeSpawn = async (o: SpawnTeammateOptions): Promise<"finished"> => {
      seen.push(o.model);
      return "finished";
    };
    const multispec: MultiSpec = {
      rootGoal: "model threading",
      subSpecs: [makeSpec("Uno"), makeSpec("Dos")],
      dependencies: [],
      rollupCompletionConditions: [],
    };

    await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir: `/tmp/cmax-test-model-${Date.now()}`,
      model: execModelForVariant("opussonnet"),
      _spawnTeammate: fakeSpawn,
      maxParallel: 2,
    });

    expect(seen).toHaveLength(2);
    expect(seen.every((m) => m === MODELS.sonnet.id)).toBe(true);
  });

  it("threads Opus when variant is opusolo", async () => {
    const seen: Array<string | undefined> = [];
    const fakeSpawn = async (o: SpawnTeammateOptions): Promise<"finished"> => {
      seen.push(o.model);
      return "finished";
    };
    const multispec: MultiSpec = {
      rootGoal: "opusolo threading",
      subSpecs: [makeSpec("Solo")],
      dependencies: [],
      rollupCompletionConditions: [],
    };

    await runAgentTeams(multispec, {
      cwd: "/tmp",
      stateDir: `/tmp/cmax-test-model-opus-${Date.now()}`,
      model: execModelForVariant("opusolo"),
      _spawnTeammate: fakeSpawn,
      maxParallel: 1,
    });

    expect(seen).toEqual([MODELS.opus.id]);
  });
});
