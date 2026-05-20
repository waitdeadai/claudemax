import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { MultiSpecPhase, PhaseHandoff } from "@claudemax/core";

const HANDOFF_DIR = ".claudemax/state/handoff";

export interface HandoffWriteOptions {
  readonly cwd?: string;
  readonly rootGoal: string;
  readonly phase: MultiSpecPhase;
  readonly previousPhase?: MultiSpecPhase;
  readonly summary: string;
  readonly nextInputs: readonly string[];
  readonly blockers?: readonly string[];
  readonly artifacts?: Readonly<Record<string, string>>;
}

export function writeHandoff(opts: HandoffWriteOptions): PhaseHandoff {
  const cwd = opts.cwd ?? process.cwd();
  const handoff: PhaseHandoff = {
    phase: opts.phase,
    previousPhase: opts.previousPhase,
    rootGoal: opts.rootGoal,
    summary: opts.summary,
    nextInputs: opts.nextInputs,
    blockers: opts.blockers ?? [],
    artifacts: opts.artifacts ?? {},
    createdAt: new Date().toISOString(),
  };
  const path = resolve(cwd, HANDOFF_DIR, `${opts.phase}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(handoff, null, 2), "utf8");
  return handoff;
}

export function readHandoff(phase: MultiSpecPhase, cwd: string = process.cwd()): PhaseHandoff | null {
  const path = resolve(cwd, HANDOFF_DIR, `${phase}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PhaseHandoff;
}

export function renderHandoffPrompt(handoff: PhaseHandoff): string {
  const artifactLines = Object.entries(handoff.artifacts)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const blockerLines = handoff.blockers.length
    ? handoff.blockers.map((b) => `  - ${b}`).join("\n")
    : "  (none)";
  const inputLines = handoff.nextInputs.map((i) => `  - ${i}`).join("\n");
  return `PHASE HANDOFF
=============
previous phase: ${handoff.previousPhase ?? "(none)"}
this phase:     ${handoff.phase}
root goal:      ${handoff.rootGoal}
created:        ${handoff.createdAt}

summary from previous phase:
${handoff.summary}

artifacts from previous phase:
${artifactLines || "  (none)"}

blockers carried forward:
${blockerLines}

inputs you should consume:
${inputLines}

Treat this handoff as the source of truth from the previous phase. You do not need to re-derive what is summarized above; consume it and move forward.`;
}
