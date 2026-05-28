import { describe, expect, it } from "vitest";
import { execModelForVariant, MODELS, type MultiSpec, type Spec } from "@claudemax/core";
import { runAgentTeams, type SpawnTeammateOptions } from "../src/agent-teams.js";

// Regression guard for the opussonnet/opusolo model-routing fix (2026-05-25) plus
// the era-aware executor flip (2026-05-28, Opus 4.8). Before the first fix --variant
// was cosmetic (exec hardcoded to Opus). The default-era (post-split) contract is
// opussonnet→Sonnet / opusolo→Opus; in the pre-split era opussonnet executes on Opus
// 4.8 (shared pool ⇒ same cost, higher ceiling). These tests pin both the contract
// and the era-aware flip + the teams-mode model threading.

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
    expect(execModelForVariant("opusolo")).toBe("claude-opus-4-8");
  });

  it("the two variants resolve to different models in the default (post-split) era", () => {
    expect(execModelForVariant("opussonnet")).not.toBe(execModelForVariant("opusolo"));
  });

  it("is era-aware: opussonnet executes on Opus 4.8 pre-split, Sonnet post-split", () => {
    expect(execModelForVariant("opussonnet", "pre-split")).toBe(MODELS.opus.id);
    expect(execModelForVariant("opussonnet", "post-split")).toBe(MODELS.sonnet.id);
    // opusolo is Opus in every era
    expect(execModelForVariant("opusolo", "pre-split")).toBe(MODELS.opus.id);
    expect(execModelForVariant("opusolo", "post-split")).toBe(MODELS.opus.id);
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
