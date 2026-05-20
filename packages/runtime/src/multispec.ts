import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MODELS,
  parseSpec,
  type MultiSpec,
  type ParallelMode,
  type ResearchBrief,
  type Spec,
  type SpecCompletionCondition,
  type VerificationReport,
  type MultiSpecVerification,
} from "@claudemax/core";

const MULTISPEC_JSON_SCHEMA = {
  type: "object",
  required: ["rootGoal", "subSpecs", "dependencies", "rollupCompletionConditions", "writeSetByspecId"],
  properties: {
    rootGoal: { type: "string" },
    subSpecs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["title", "goal", "nonGoals", "constraints", "completionConditions", "assumptions", "evidenceRequired"],
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          nonGoals: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          completionConditions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["id", "description", "verifyHint"],
              properties: {
                id: { type: "string" },
                description: { type: "string" },
                verifyHint: { type: "string" },
                interactive: {
                  type: "object",
                  required: ["tool", "script"],
                  properties: {
                    tool: { type: "string", enum: ["playwright", "browser", "shell"] },
                    script: { type: "string" },
                    timeoutMs: { type: "number" },
                    expect: { type: "string" },
                  },
                },
              },
            },
          },
          assumptions: { type: "array", items: { type: "string" } },
          evidenceRequired: { type: "array", items: { type: "string" } },
        },
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
      },
    },
    rollupCompletionConditions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "description", "verifyHint"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          verifyHint: { type: "string" },
          interactive: {
            type: "object",
            required: ["tool", "script"],
            properties: {
              tool: { type: "string", enum: ["playwright", "browser", "shell"] },
              script: { type: "string" },
              timeoutMs: { type: "number" },
              expect: { type: "string" },
            },
          },
        },
      },
    },
    writeSetByspecId: {
      type: "object",
      additionalProperties: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export interface DecomposeOptions {
  readonly cwd?: string;
  readonly researchBrief?: ResearchBrief;
}

export async function decomposeIntoMultiSpec(
  rootGoal: string,
  opts: DecomposeOptions = {},
): Promise<MultiSpec> {
  const briefSection = opts.researchBrief
    ? `\n\nResearch brief:\n${JSON.stringify(opts.researchBrief, null, 2)}\n`
    : "";
  const userMsg = `Decompose this root goal into a MultiSpec:\n\nROOT GOAL: ${rootGoal}${briefSection}\n\nProduce 2–12 sub-Specs, each independently verifiable with measurable completion conditions. Annotate each sub-Spec's write-set (files it will modify) so the engine can detect overlap. Define the DAG of dependencies (sub-Spec A depends on sub-Spec B). Add rollup completion conditions that verify the combined goal.\n\nReturn only the JSON object.`;

  let finalResult = "";

  for await (const message of query({
    prompt: userMsg,
    options: {
      model: MODELS.opus.id,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: MULTISPEC_DECOMPOSER_SYSTEM,
      },
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      maxTurns: 30,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
      outputFormat: { type: "json_schema", schema: MULTISPEC_JSON_SCHEMA },
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
  if (!jsonMatch) throw new Error(`multispec decomposer returned no JSON. Raw:\n${finalResult.slice(0, 500)}`);
  const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const now = new Date().toISOString();
  const subSpecs = (obj["subSpecs"] as unknown[]).map((s, i) => {
    const sp = s as Record<string, unknown>;
    if (!sp["createdAt"]) sp["createdAt"] = now;
    if (!sp["title"]) sp["title"] = `sub-spec-${i + 1}`;
    return parseSpec(sp);
  });

  const writeSetByspecId = (obj["writeSetByspecId"] ?? {}) as Record<string, readonly string[]>;
  const mode = selectParallelMode(subSpecs, writeSetByspecId);

  return {
    rootGoal: (obj["rootGoal"] as string) ?? rootGoal,
    researchBrief: opts.researchBrief,
    subSpecs,
    dependencies: (obj["dependencies"] ?? []) as readonly { from: string; to: string }[],
    rollupCompletionConditions: (obj["rollupCompletionConditions"] ?? []) as readonly SpecCompletionCondition[],
    writeSetByspecId,
    mode: mode.mode,
    modeReason: mode.reason,
    createdAt: now,
  };
}

export function selectParallelMode(
  subSpecs: readonly Spec[],
  writeSetByspecId: Readonly<Record<string, readonly string[]>>,
  override?: ParallelMode,
): { mode: ParallelMode; reason: string } {
  if (override === "solo" || override === "teams") {
    return { mode: override, reason: `forced via --mode=${override}` };
  }
  const subSpecCount = subSpecs.length;
  const writeSets = Object.values(writeSetByspecId);
  const overlap = hasWriteSetOverlap(writeSets);
  const estTimeMin = subSpecCount * 8;

  if (subSpecCount > 5 || estTimeMin > 30 || overlap) {
    const reasons: string[] = [];
    if (subSpecCount > 5) reasons.push(`subSpecs=${subSpecCount}>5`);
    if (estTimeMin > 30) reasons.push(`est=${estTimeMin}min>30`);
    if (overlap) reasons.push(`write-set overlap`);
    return { mode: "teams", reason: reasons.join(", ") };
  }
  return { mode: "solo", reason: `subSpecs=${subSpecCount}, est=${estTimeMin}min, no overlap` };
}

function hasWriteSetOverlap(writeSets: readonly (readonly string[])[]): boolean {
  for (let i = 0; i < writeSets.length; i++) {
    for (let j = i + 1; j < writeSets.length; j++) {
      const a = new Set(writeSets[i]);
      for (const p of writeSets[j] ?? []) if (a.has(p)) return true;
    }
  }
  return false;
}

export interface RunMultiSpecOptions {
  readonly cwd?: string;
  readonly mode?: ParallelMode;
  readonly maxParallel?: number;
  readonly onPhase?: (phase: string, detail?: string) => void;
}

export interface MultiSpecRunResult {
  readonly multispec: MultiSpec;
  readonly verification: MultiSpecVerification;
  readonly mode: ParallelMode;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

const MULTISPEC_DECOMPOSER_SYSTEM = `You are the claudemax multispec decomposer.

Decompose a large goal into 2–12 small, independently-verifiable sub-Specs. Each sub-Spec must be:
- Small enough that an autonomous /goal loop can complete it in ~20–60 turns.
- Independently verifiable — completion conditions must each have a verifyHint a blind reviewer could mechanically check (file path, command, test, behavior).
- Annotated with its writeSet — the file paths it will modify. The engine uses this to detect overlap and pick the right parallelism mode.

Define the DAG of dependencies between sub-Specs (A depends on B means B must finish before A starts).

Add rollupCompletionConditions — high-level checks that verify the COMBINED goal across all sub-Specs (integration tests, end-to-end behaviors).

Hard rules:
- Output ONLY a JSON object matching the MultiSpec schema. No prose, no markdown fences.
- Every sub-Spec needs ≥ 1 completion condition with a mechanically-checkable verifyHint.
- Every sub-Spec needs a writeSet entry (may be empty array for spec-spec or research sub-specs).
- The DAG must be acyclic.`;

export function topologicalLeafFrontier(
  remaining: ReadonlySet<string>,
  dependencies: readonly { from: string; to: string }[],
): readonly string[] {
  const frontier: string[] = [];
  for (const id of remaining) {
    const blocked = dependencies.some((d) => d.from === id && remaining.has(d.to));
    if (!blocked) frontier.push(id);
  }
  return frontier;
}

export function rollupVerdict(
  perSubSpec: readonly VerificationReport[],
  rollup: VerificationReport,
): "verified" | "partial" | "failed" {
  if (rollup.verdict === "failed") return "failed";
  const allVerified = perSubSpec.every((r) => r.verdict === "verified");
  if (allVerified && rollup.verdict === "verified") return "verified";
  if (perSubSpec.every((r) => r.verdict === "failed")) return "failed";
  return "partial";
}
