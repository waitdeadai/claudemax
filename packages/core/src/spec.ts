import { z } from "zod";
import type { Spec, SpecCompletionCondition } from "./types.js";

const interactiveVerifyHintSchema = z.object({
  tool: z.enum(["playwright", "browser", "shell"]),
  script: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  expect: z.string().optional(),
});

const completionConditionSchema = z.object({
  id: z.string(),
  description: z.string(),
  verifyHint: z.string(),
  interactive: interactiveVerifyHintSchema.optional(),
});

const specSchema = z.object({
  title: z.string(),
  goal: z.string(),
  nonGoals: z.array(z.string()),
  constraints: z.array(z.string()),
  completionConditions: z.array(completionConditionSchema).min(1),
  assumptions: z.array(z.string()),
  evidenceRequired: z.array(z.string()),
  createdAt: z.string(),
});

export function parseSpec(input: unknown): Spec {
  return specSchema.parse(input) as Spec;
}

export function renderSpecMarkdown(spec: Spec): string {
  const cc = spec.completionConditions
    .map(
      (c, i) =>
        `${i + 1}. **${c.id}** — ${c.description}\n   - Verify: ${c.verifyHint}`,
    )
    .join("\n");
  const ng = spec.nonGoals.map((g) => `- ${g}`).join("\n") || "- (none)";
  const cs = spec.constraints.map((c) => `- ${c}`).join("\n") || "- (none)";
  const as_ = spec.assumptions.map((a) => `- ${a}`).join("\n") || "- (none)";
  const ev = spec.evidenceRequired.map((e) => `- ${e}`).join("\n") || "- (none)";

  return `# ${spec.title}

> Created: ${spec.createdAt}

## Goal
${spec.goal}

## Completion conditions
${cc}

## Non-goals
${ng}

## Constraints
${cs}

## Assumptions
${as_}

## Evidence required
${ev}
`;
}

const HEADING = /^##\s+/;

export function parseSpecMarkdown(md: string): Spec {
  const lines = md.split("\n");
  let title = "";
  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      break;
    }
  }

  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of lines) {
    if (HEADING.test(line)) {
      current = line.replace(HEADING, "").trim().toLowerCase();
      sections[current] = [];
      continue;
    }
    if (current) sections[current]!.push(line);
  }

  const bullets = (key: string): string[] =>
    (sections[key] ?? [])
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") && !l.startsWith("- (none)"))
      .map((l) => l.slice(2).trim());

  const goal = (sections["goal"] ?? []).join("\n").trim();

  const ccLines = (sections["completion conditions"] ?? [])
    .map((l) => l.trim())
    .filter((l) => /^\d+\./.test(l));
  const completionConditions: SpecCompletionCondition[] = ccLines.map((line, idx) => {
    const m = /^\d+\.\s+\*\*(.+?)\*\*\s+—\s+(.+)$/.exec(line);
    return {
      id: m?.[1] ?? `cc-${idx + 1}`,
      description: m?.[2] ?? line,
      verifyHint: "manual",
    };
  });

  const createdMatch = /Created:\s*(.+)/.exec(md);

  return parseSpec({
    title,
    goal,
    nonGoals: bullets("non-goals"),
    constraints: bullets("constraints"),
    completionConditions,
    assumptions: bullets("assumptions"),
    evidenceRequired: bullets("evidence required"),
    createdAt: createdMatch?.[1]?.trim() ?? new Date().toISOString(),
  });
}

export function emptySpec(title: string, goal: string): Spec {
  return {
    title,
    goal,
    nonGoals: [],
    constraints: [],
    completionConditions: [
      {
        id: "cc-1",
        description: "(define measurable completion condition)",
        verifyHint: "(how a blind verifier would confirm this)",
      },
    ],
    assumptions: [],
    evidenceRequired: [],
    createdAt: new Date().toISOString(),
  };
}
