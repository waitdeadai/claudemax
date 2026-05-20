import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type Spec } from "@claudemax/core";
import { GOAL_DRIVER_SYSTEM } from "./prompts.js";
import {
  baseSdkOptions,
  estimateTaskBudgetTokens,
  parseUsageWithCache,
  type EffortLevel,
} from "./sdk-options.js";

export interface GoalRunOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto";
  readonly effort?: EffortLevel;
  readonly onTurn?: (turn: number, snippet: string) => void;
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
  readonly resume?: string;
}

export interface GoalRunResult {
  readonly status: "finished" | "blocked" | "max-turns";
  readonly summary: string;
  readonly evidence: Record<string, string>;
  readonly turns: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly sessionId?: string;
}

export async function runGoal(spec: Spec, opts: GoalRunOptions = {}): Promise<GoalRunResult> {
  const maxTurns = opts.maxTurns ?? 200;
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let finalResult = "";
  let sessionId: string | undefined;

  const base = baseSdkOptions({
    cwd: opts.cwd,
    env: opts.env,
    maxTurns,
    effort: opts.effort,
    thinking: "adaptive", // Opus 4.7: adaptive thinking is off by default; we opt in for goal-loop reasoning
    maxBudgetUsd: opts.maxBudgetUsd,
    taskBudgetTokens:
      opts.maxBudgetUsd !== undefined
        ? estimateTaskBudgetTokens("opus", opts.maxBudgetUsd)
        : undefined,
    abortSignal: opts.abortSignal,
  });

  for await (const message of query({
    prompt: `Pursue the goal in the system prompt. Begin by re-reading the SPEC carefully, then act. Stop only when every completion condition is met or you are genuinely blocked.`,
    options: {
      model: MODELS.opus.id,
      fallbackModel: MODELS.sonnet.id,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: GOAL_DRIVER_SYSTEM(spec),
      },
      allowedTools: [
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Agent",
      ],
      permissionMode: opts.permissionMode ?? "acceptEdits",
      resume: opts.resume,
      ...base,
    } as never,
  })) {
    const m = message as {
      type?: string;
      subtype?: string;
      session_id?: string;
      result?: string;
      usage?: unknown;
    };
    if (m.type === "system" && m.subtype === "init" && m.session_id) {
      sessionId = m.session_id;
    }
    if (m.type === "assistant") {
      turns += 1;
      opts.onTurn?.(turns, "");
    }
    if (m.type === "result" && typeof m.result === "string") {
      finalResult = m.result;
      if (m.usage) {
        const stats = parseUsageWithCache(m.usage);
        tokensIn += stats.inputTokens;
        tokensOut += stats.outputTokens;
        cacheReadTokens += stats.cacheReadTokens;
        cacheWriteTokens += stats.cacheWrite5mTokens + stats.cacheWrite1hTokens;
      }
    }
  }

  const evidence: Record<string, string> = {};
  const finishedMatch = /FINISHED([\s\S]*?)(?:SUMMARY:|$)/.exec(finalResult);
  const blockedMatch = /BLOCKED([\s\S]*)/.exec(finalResult);

  let status: GoalRunResult["status"] = "max-turns";
  let summary = finalResult.slice(0, 4000);

  if (finishedMatch) {
    status = "finished";
    for (const line of (finishedMatch[1] ?? "").split("\n")) {
      const m = /-\s*([\w-]+):\s*(.+)/.exec(line.trim());
      if (m) evidence[m[1]!] = m[2]!;
    }
    const sumMatch = /SUMMARY:\s*([\s\S]+)$/.exec(finalResult);
    if (sumMatch) summary = sumMatch[1]!.trim();
  } else if (blockedMatch) {
    status = "blocked";
    summary = blockedMatch[1]?.trim() ?? "";
  }

  return {
    status,
    summary,
    evidence,
    turns,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheWriteTokens,
    sessionId,
  };
}
