import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultFeaturesPath,
  featuresComplete,
  markFeaturePasses,
  markFeatureBlocked,
  pendingFeatures,
  progressSummary,
  readFeatures,
  scaffoldFeatures,
} from "../src/features-list.js";

function freshDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cmax-features-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("features-list (Anthropic 2025-11-26 pattern)", () => {
  it("scaffoldFeatures creates a single-feature file from a goal", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-1");
      const f = scaffoldFeatures(path, { laneId: "lane-1", goal: "build webhook receiver" });
      expect(f.version).toBe(1);
      expect(f.laneId).toBe("lane-1");
      expect(f.features.length).toBe(1);
      expect(f.features[0]!.passes).toBe(false);
      expect(f.features[0]!.description).toBe("build webhook receiver");
    } finally {
      cleanup();
    }
  });

  it("scaffoldFeatures is idempotent — re-scaffold returns existing file unchanged", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-2");
      const first = scaffoldFeatures(path, { laneId: "lane-2", goal: "goal-A" });
      const second = scaffoldFeatures(path, { laneId: "lane-2", goal: "goal-B-different" });
      expect(second.goal).toBe(first.goal);
      expect(second.features[0]!.description).toBe("goal-A");
    } finally {
      cleanup();
    }
  });

  it("scaffoldFeatures accepts explicit seed breakdown", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-3");
      const f = scaffoldFeatures(path, {
        laneId: "lane-3",
        goal: "ship payments",
        seedFeatures: [
          { id: "p-1", description: "webhook verify" },
          { id: "p-2", description: "idempotency map" },
          { id: "p-3", description: "tenant provisioner" },
        ],
      });
      expect(f.features.length).toBe(3);
      expect(pendingFeatures(f).length).toBe(3);
      expect(featuresComplete(f)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("markFeaturePasses flips passes and clears any blocker", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-4");
      scaffoldFeatures(path, {
        laneId: "lane-4",
        goal: "g",
        seedFeatures: [
          { id: "f-1", description: "first" },
          { id: "f-2", description: "second" },
        ],
      });
      markFeatureBlocked(path, "f-1", "missing API key");
      const blocked = readFeatures(path)!;
      expect(blocked.features[0]!.blocker).toBe("missing API key");
      markFeaturePasses(path, "f-1");
      const after = readFeatures(path)!;
      expect(after.features[0]!.passes).toBe(true);
      expect(after.features[0]!.blocker).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("progressSummary tracks done/pending/blocked + next id", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-5");
      scaffoldFeatures(path, {
        laneId: "lane-5",
        goal: "g",
        seedFeatures: [
          { id: "a", description: "a" },
          { id: "b", description: "b" },
          { id: "c", description: "c" },
        ],
      });
      markFeaturePasses(path, "a");
      markFeatureBlocked(path, "b", "waiting on X");
      const s = progressSummary(readFeatures(path)!);
      expect(s.total).toBe(3);
      expect(s.done).toBe(1);
      expect(s.pending).toBe(2);
      expect(s.blocked).toBe(1);
      expect(s.nextId).toBe("c");
    } finally {
      cleanup();
    }
  });

  it("featuresComplete returns true only when every feature passes", () => {
    const { dir, cleanup } = freshDir();
    try {
      const path = defaultFeaturesPath(dir, "lane-6");
      scaffoldFeatures(path, {
        laneId: "lane-6",
        goal: "g",
        seedFeatures: [
          { id: "x", description: "x" },
          { id: "y", description: "y" },
        ],
      });
      markFeaturePasses(path, "x");
      expect(featuresComplete(readFeatures(path)!)).toBe(false);
      markFeaturePasses(path, "y");
      expect(featuresComplete(readFeatures(path)!)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
