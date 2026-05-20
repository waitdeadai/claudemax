import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, parseSpec, type Spec } from "@claudemax/core";
import { SPEC_WRITER_SYSTEM } from "./prompts.js";

export interface SpecWriteOptions {
  readonly cwd?: string;
  readonly context?: string;
}

const SPEC_JSON_SCHEMA = {
  type: "object",
  required: [
    "title",
    "goal",
    "nonGoals",
    "constraints",
    "completionConditions",
    "assumptions",
    "evidenceRequired",
  ],
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
        },
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    evidenceRequired: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" },
  },
} as const;

export async function writeSpec(goal: string, opts: SpecWriteOptions = {}): Promise<Spec> {
  const userMsg = opts.context
    ? `User goal:\n${goal}\n\nRepository context:\n${opts.context}\n\nReturn the JSON spec object.`
    : `User goal:\n${goal}\n\nReturn the JSON spec object.`;

  let finalResult = "";

  for await (const message of query({
    prompt: userMsg,
    options: {
      model: MODELS.opus.id,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: SPEC_WRITER_SYSTEM,
      },
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "default",
      maxTurns: 20,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
      outputFormat: { type: "json_schema", schema: SPEC_JSON_SCHEMA },
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") {
      finalResult = m.result;
    }
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
  if (!jsonMatch) {
    throw new Error(`spec writer returned no JSON. Raw:\n${finalResult.slice(0, 500)}`);
  }
  const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  if (!obj["createdAt"]) obj["createdAt"] = new Date().toISOString();
  return parseSpec(obj);
}
