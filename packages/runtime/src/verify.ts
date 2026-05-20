import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type Spec, type VerificationReport } from "@claudemax/core";
import { VERIFIER_SYSTEM } from "./prompts.js";

export interface VerifyOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly env?: Record<string, string>;
}

const VERIFICATION_JSON_SCHEMA = {
  type: "object",
  required: ["perCondition", "verdict"],
  properties: {
    perCondition: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "met", "evidence"],
        properties: {
          id: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
    verdict: { type: "string", enum: ["verified", "partial", "failed"] },
    notes: { type: "string" },
  },
} as const;

export async function verify(spec: Spec, opts: VerifyOptions = {}): Promise<VerificationReport> {
  let finalResult = "";

  for await (const message of query({
    prompt: `Verify the SPEC was met. Read the repo, run checks, then output the JSON object exactly as specified.`,
    options: {
      model: MODELS.opus.id,
      effort: "max",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: VERIFIER_SYSTEM(spec),
      },
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      permissionMode: "default",
      maxTurns: opts.maxTurns ?? 40,
      cwd: opts.cwd,
      env: opts.env,
      settingSources: ["user", "project"],
      enableFileCheckpointing: false,
      outputFormat: { type: "json_schema", schema: VERIFICATION_JSON_SCHEMA },
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") {
      finalResult = m.result;
    }
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
  if (!jsonMatch) {
    return {
      spec,
      perCondition: spec.completionConditions.map((c) => ({
        id: c.id,
        met: false,
        evidence: "verifier did not return parseable JSON",
      })),
      verdict: "failed",
      verifierTier: "opus",
      notes: `verifier raw output: ${finalResult.slice(0, 500)}`,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      perCondition: { id: string; met: boolean; evidence: string }[];
      verdict: "verified" | "partial" | "failed";
      notes?: string;
    };
    return {
      spec,
      perCondition: parsed.perCondition,
      verdict: parsed.verdict,
      verifierTier: "opus",
      notes: parsed.notes ?? "",
    };
  } catch (err) {
    return {
      spec,
      perCondition: spec.completionConditions.map((c) => ({
        id: c.id,
        met: false,
        evidence: `verifier JSON parse failed: ${(err as Error).message}`,
      })),
      verdict: "failed",
      verifierTier: "opus",
      notes: finalResult.slice(0, 500),
    };
  }
}
