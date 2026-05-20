import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type ModelTier } from "@claudemax/core";

export interface HiveOptions {
  readonly cwd?: string;
  readonly proposers?: number;
  readonly proposerTier?: ModelTier;
  readonly mergerTier?: ModelTier;
  readonly maxTurnsPerProposer?: number;
}

export interface HiveProposal {
  readonly proposer: number;
  readonly tier: ModelTier;
  readonly text: string;
}

export interface HiveResult {
  readonly proposals: readonly HiveProposal[];
  readonly merged: string;
}

export async function runHive(
  problem: string,
  opts: HiveOptions = {},
): Promise<HiveResult> {
  const n = opts.proposers ?? 3;
  const proposerTier = opts.proposerTier ?? "opus";
  const mergerTier = opts.mergerTier ?? "opus";

  const proposals = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      let final = "";
      for await (const message of query({
        prompt: `You are proposer #${i + 1} of ${n}. Independently draft a proposal for this problem:\n\n${problem}\n\nDo NOT consult other proposers. Be specific and concise.`,
        options: {
          model: MODELS[proposerTier].id,
          effort: "max",
          allowedTools: ["Read", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          maxTurns: opts.maxTurnsPerProposer ?? 15,
          cwd: opts.cwd,
          settingSources: ["user", "project"],
        } as never,
      })) {
        const m = message as { type?: string; result?: string };
        if (m.type === "result" && typeof m.result === "string") final = m.result;
      }
      return { proposer: i + 1, tier: proposerTier, text: final };
    }),
  );

  let merged = "";
  const mergeInput = proposals
    .map((p) => `### Proposal ${p.proposer} (${p.tier})\n${p.text}`)
    .join("\n\n");
  for await (const message of query({
    prompt: `Merge the following ${n} independent proposals into ONE superior answer. Cite which proposal contributed which idea. Resolve contradictions explicitly.\n\n${mergeInput}`,
    options: {
      model: MODELS[mergerTier].id,
      effort: "max",
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      maxTurns: 15,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") merged = m.result;
  }

  return { proposals, merged };
}
