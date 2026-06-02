// The verdict artifact — the keystone of the effectiveness OS (Frente B.4 + C).
//
// verify() used to compute a VerificationReport in memory and exit 0/1, leaving
// nothing on disk. With no durable artifact, no deterministic hook could gate
// "done" on actual verification state — the Stop/SubagentStop battery could only
// scan the transcript for text tells. This module persists a machine-readable,
// per-condition verdict with DEFAULT-FAIL semantics. The same gate logic
// (computeGate) is shared by verify() and the cmax-verdict-gate.sh hook so the
// runtime and the kernel agree on exactly one definition of "done".

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Spec, VerificationFinding } from "@claudemax/core";

export const VERDICT_SCHEMA_VERSION = "cmax.verdict.v1";

export type VerdictValue = "verified" | "partial" | "failed" | "unverified";

export interface VerdictGate {
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

export interface VerdictConditionRow {
  readonly id: string;
  readonly met: boolean;
  readonly evidence: string;
  readonly confidence: number;
  readonly evidenceArtifacts?: readonly string[];
  readonly timedOut?: boolean;
  readonly failureCategory?: string;
}

export interface VerdictArtifact {
  readonly schema: string;
  readonly specHash: string;
  readonly title: string;
  readonly goal: string;
  readonly cwd: string;
  readonly verifiedAt: string;
  readonly verifierTier: string;
  readonly verdict: VerdictValue;
  readonly confidenceThreshold: number;
  readonly allConditionIds: readonly string[];
  readonly perCondition: readonly VerdictConditionRow[];
  readonly gate: VerdictGate;
}

// Stable hash of a spec's identity (goal + each condition's id/verifyHint). Lets
// the gate correlate "the run that is active" with "the verdict on disk".
export function specHash(spec: Spec): string {
  const basis = JSON.stringify({
    goal: spec.goal,
    conditions: spec.completionConditions.map((c) => ({ id: c.id, v: c.verifyHint })),
  });
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function stateDir(cwd: string): string {
  return resolve(cwd, ".claudemax", "state");
}

export function verdictPath(cwd: string, hash: string): string {
  return join(stateDir(cwd), `verdict-${hash}.json`);
}

export function latestVerdictPath(cwd: string): string {
  return join(stateDir(cwd), "verdict-latest.json");
}

// DEFAULT-FAIL gate — the single definition of "done".
// A condition passes ONLY if: a finding exists for it, met===true, evidence is
// non-empty, and confidence >= threshold. A declared condition with NO finding
// fails (closes the "model silently omitted a condition" hole). The whole gate
// passes only if every declared condition passes AND the verdict is "verified".
export function computeGate(
  allConditionIds: readonly string[],
  rows: readonly VerdictConditionRow[],
  verdict: string,
  threshold: number,
): VerdictGate {
  const reasons: string[] = [];
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  if (allConditionIds.length === 0) {
    reasons.push("spec declares no completion conditions — nothing verifiable (default-FAIL)");
  }
  for (const id of allConditionIds) {
    const r = byId.get(id);
    if (!r) {
      reasons.push(`condition "${id}" has no verifier finding (default-FAIL)`);
      continue;
    }
    if (!r.met) {
      reasons.push(`condition "${id}" not met`);
      continue;
    }
    if (!r.evidence || r.evidence.trim() === "") {
      reasons.push(`condition "${id}" marked met but evidence is empty (evidence-required)`);
      continue;
    }
    if (r.confidence < threshold) {
      reasons.push(
        `condition "${id}" met but confidence ${r.confidence.toFixed(2)} < threshold ${threshold}`,
      );
    }
  }
  if (verdict !== "verified") reasons.push(`verdict is "${verdict}", not "verified"`);
  return { pass: reasons.length === 0, reasons };
}

export function findingToRow(f: VerificationFinding): VerdictConditionRow {
  return {
    id: f.id,
    met: f.met,
    evidence: f.evidence,
    confidence: f.confidence,
    ...(f.evidenceArtifacts?.length ? { evidenceArtifacts: f.evidenceArtifacts } : {}),
    ...(f.timedOut ? { timedOut: true } : {}),
    ...(f.failureCategory ? { failureCategory: f.failureCategory } : {}),
  };
}

export interface BuildVerdictInput {
  readonly spec: Spec;
  // One finding per declared condition (verify() guarantees completeness before
  // calling this; any missing condition still fails via computeGate).
  readonly allFindings: readonly VerificationFinding[];
  readonly verdict: VerdictValue;
  readonly verifierTier: string;
  readonly confidenceThreshold: number;
  readonly cwd: string;
  readonly now?: string;
}

export function buildVerdictArtifact(input: BuildVerdictInput): VerdictArtifact {
  const allConditionIds = input.spec.completionConditions.map((c) => c.id);
  const rows = input.allFindings.map(findingToRow);
  const gate = computeGate(allConditionIds, rows, input.verdict, input.confidenceThreshold);
  return {
    schema: VERDICT_SCHEMA_VERSION,
    specHash: specHash(input.spec),
    title: input.spec.title,
    goal: input.spec.goal,
    cwd: input.cwd,
    verifiedAt: input.now ?? new Date().toISOString(),
    verifierTier: input.verifierTier,
    verdict: input.verdict,
    confidenceThreshold: input.confidenceThreshold,
    allConditionIds,
    perCondition: rows,
    gate,
  };
}

export interface WriteVerdictResult {
  readonly path: string;
  readonly latestPath: string;
  readonly artifact: VerdictArtifact;
}

// Persist the verdict to .claudemax/state/verdict-<hash>.json AND mirror it to
// verdict-latest.json (the gate hook reads the latest). Returns the artifact so
// callers can branch on artifact.gate.pass without re-reading disk.
export function writeVerdict(input: BuildVerdictInput): WriteVerdictResult {
  const dir = stateDir(input.cwd);
  mkdirSync(dir, { recursive: true });
  const artifact = buildVerdictArtifact(input);
  const path = verdictPath(input.cwd, artifact.specHash);
  const latestPath = latestVerdictPath(input.cwd);
  const json = JSON.stringify(artifact, null, 2);
  writeFileSync(path, json, "utf8");
  writeFileSync(latestPath, json, "utf8");
  return { path, latestPath, artifact };
}

export function readVerdict(path: string): VerdictArtifact | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as VerdictArtifact;
    return parsed && parsed.schema === VERDICT_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

// Active-run sentinel. The autonomous runtime marks a run active at goal start so
// the Stop/SubagentStop gate engages ONLY during an autonomous run. Interactive
// chat sessions (no sentinel) are never blocked — the gate is opt-in by context,
// not a global tax on every Stop.
export interface ActiveRun {
  readonly specHash: string;
  readonly title: string;
  readonly startedAt: string;
}

export function activeRunPath(cwd: string): string {
  return join(stateDir(cwd), "active-run.json");
}

export function markRunActive(spec: Spec, cwd: string, now?: string): ActiveRun {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const run: ActiveRun = {
    specHash: specHash(spec),
    title: spec.title,
    startedAt: now ?? new Date().toISOString(),
  };
  writeFileSync(activeRunPath(cwd), JSON.stringify(run, null, 2), "utf8");
  return run;
}

export function readActiveRun(cwd: string): ActiveRun | null {
  try {
    return JSON.parse(readFileSync(activeRunPath(cwd), "utf8")) as ActiveRun;
  } catch {
    return null;
  }
}

export function clearActiveRun(cwd: string): void {
  const p = activeRunPath(cwd);
  if (existsSync(p)) {
    try {
      rmSync(p);
    } catch {
      /* ignore */
    }
  }
}

// Clear the sentinel ONLY if it belongs to the given spec. During a multispec run
// the per-sub-Spec verifies must NOT clear the root run's sentinel — only the
// rollup verify (whose hash matches the armed root spec) does. Returns whether it
// cleared.
export function clearActiveRunIfMatches(cwd: string, hash: string): boolean {
  const run = readActiveRun(cwd);
  if (run && run.specHash === hash) {
    clearActiveRun(cwd);
    return true;
  }
  return false;
}
