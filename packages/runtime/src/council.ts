import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@claudemax/core";

export interface CouncilOptions {
  readonly cwd?: string;
  readonly maxTurnsPerRole?: number;
}

export interface CouncilResult {
  readonly proposal: string;
  readonly critique: string;
  readonly judgment: string;
}

export async function runCouncil(
  question: string,
  opts: CouncilOptions = {},
): Promise<CouncilResult> {
  const maxTurns = opts.maxTurnsPerRole ?? 15;

  const [proposal, critique] = await Promise.all([
    runRole(
      "proposer",
      `You are the PROPOSER. Make the strongest case FOR a specific position on this question:\n\n${question}\n\nBe specific, cite evidence, propose a concrete answer.`,
      opts.cwd,
      maxTurns,
    ),
    runRole(
      "critic",
      `You are the CRITIC. Make the strongest case AGAINST any obvious position on this question:\n\n${question}\n\nFind holes, edge cases, costs, alternative framings. Be specific.`,
      opts.cwd,
      maxTurns,
    ),
  ]);

  const judgment = await runRole(
    "judge",
    `You are the JUDGE. Render a final decision on this question:\n\n${question}\n\n=== PROPOSER ===\n${proposal}\n\n=== CRITIC ===\n${critique}\n\nWeight both sides. Render a decision with rationale. Note conditions under which the decision would flip.`,
    opts.cwd,
    maxTurns,
  );

  return { proposal, critique, judgment };
}

async function runRole(
  role: "proposer" | "critic" | "judge",
  prompt: string,
  cwd: string | undefined,
  maxTurns: number,
): Promise<string> {
  let final = "";
  for await (const message of query({
    prompt,
    options: {
      model: MODELS.opus.id,
      effort: "max",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `You are acting as the ${role} in a 3-Opus adversarial council. Stay in role.`,
      },
      allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
      permissionMode: "bypassPermissions",
      maxTurns,
      cwd,
      settingSources: ["user", "project"],
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") final = m.result;
  }
  return final;
}
