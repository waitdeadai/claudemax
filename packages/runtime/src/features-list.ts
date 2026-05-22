// Per-lane features.json checklist — Anthropic Nov 26 2025 long-running-agent
// pattern. The coding agent reads the file at session start, picks ONE feature
// with passes:false, implements it, runs verifier, sets passes:true, commits,
// exits. Across sessions the file is the durable progress ledger.
//
// Source: https://www.anthropic.com/engineering/effective-harnesses-for-
// long-running-agents (2025-11-26). Key quote: "we landed on using JSON for
// this, as the model is less likely to inappropriately change or overwrite
// JSON files." Hence: JSON, not Markdown.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Feature {
  readonly id: string;
  readonly description: string;
  passes: boolean;
  readonly addedAt: string;
  lastAttemptedAt?: string;
  blocker?: string;
}

export interface FeaturesFile {
  readonly version: 1;
  readonly laneId: string;
  readonly goal: string;
  readonly createdAt: string;
  features: Feature[];
}

export function defaultFeaturesPath(cwd: string, laneId: string): string {
  return join(cwd, ".claudemax", "lanes", laneId, "features.json");
}

export function readFeatures(path: string): FeaturesFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FeaturesFile;
  } catch {
    return null;
  }
}

export function writeFeatures(path: string, file: FeaturesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

// Scaffold an initial features.json for a lane. If the file already exists,
// returns the existing file unchanged — idempotent so resumes don't clobber.
// Goal can be decomposed into N features; pass `seedFeatures` for explicit
// breakdown, otherwise the single-feature fallback is used.
export function scaffoldFeatures(
  path: string,
  args: {
    readonly laneId: string;
    readonly goal: string;
    readonly seedFeatures?: ReadonlyArray<{ id: string; description: string }>;
  },
): FeaturesFile {
  const existing = readFeatures(path);
  if (existing) return existing;
  const now = new Date().toISOString();
  const features: Feature[] = (args.seedFeatures ?? [
    { id: `${args.laneId}-001`, description: args.goal },
  ]).map((f) => ({
    id: f.id,
    description: f.description,
    passes: false,
    addedAt: now,
  }));
  const file: FeaturesFile = {
    version: 1,
    laneId: args.laneId,
    goal: args.goal,
    createdAt: now,
    features,
  };
  writeFeatures(path, file);
  return file;
}

export function pendingFeatures(file: FeaturesFile): readonly Feature[] {
  return file.features.filter((f) => !f.passes);
}

// Mark a feature passes=true and refresh lastAttemptedAt. Returns the
// updated file (also written to disk). Throws if the feature id is unknown.
export function markFeaturePasses(path: string, featureId: string): FeaturesFile {
  const file = readFeatures(path);
  if (!file) throw new Error(`features file not found: ${path}`);
  const idx = file.features.findIndex((f) => f.id === featureId);
  if (idx < 0) throw new Error(`unknown feature: ${featureId}`);
  const now = new Date().toISOString();
  file.features[idx] = {
    ...file.features[idx]!,
    passes: true,
    lastAttemptedAt: now,
    blocker: undefined,
  };
  writeFeatures(path, file);
  return file;
}

// Mark a feature blocked with a one-line reason. Leaves passes=false.
// Returns the updated file.
export function markFeatureBlocked(
  path: string,
  featureId: string,
  blocker: string,
): FeaturesFile {
  const file = readFeatures(path);
  if (!file) throw new Error(`features file not found: ${path}`);
  const idx = file.features.findIndex((f) => f.id === featureId);
  if (idx < 0) throw new Error(`unknown feature: ${featureId}`);
  const now = new Date().toISOString();
  file.features[idx] = {
    ...file.features[idx]!,
    passes: false,
    lastAttemptedAt: now,
    blocker,
  };
  writeFeatures(path, file);
  return file;
}

export function featuresComplete(file: FeaturesFile): boolean {
  return file.features.every((f) => f.passes);
}

export function progressSummary(file: FeaturesFile): {
  readonly total: number;
  readonly done: number;
  readonly pending: number;
  readonly blocked: number;
  readonly nextId: string | null;
} {
  const total = file.features.length;
  const done = file.features.filter((f) => f.passes).length;
  const blocked = file.features.filter((f) => !f.passes && f.blocker).length;
  const next = file.features.find((f) => !f.passes && !f.blocker);
  return {
    total,
    done,
    pending: total - done,
    blocked,
    nextId: next?.id ?? null,
  };
}
