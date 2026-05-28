import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { MODELS, modelById, type ModelId, type Spec } from "@claudemax/core";
import { GOAL_DRIVER_SYSTEM } from "./prompts.js";
import {
  baseSdkOptions,
  buildOtelEnv,
  estimateTaskBudgetTokens,
  parseUsageWithCache,
  type EffortLevel,
} from "./sdk-options.js";

export interface GoalRunOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  /** Executor model. Defaults to Opus; opussonnet routing passes Sonnet here. */
  readonly model?: ModelId;
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
  const execModel = opts.model ?? MODELS.opus.id;
  const execTier = modelById(execModel).tier;
  // Fallback to the other major tier so an overload on the executor still makes progress.
  const fallbackModel = execModel === MODELS.sonnet.id ? MODELS.opus.id : MODELS.sonnet.id;
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
    thinking: "adaptive", // Opus 4.8: adaptive thinking is off unless opted in; we opt in for goal-loop reasoning (extended thinking is unsupported on 4.8)
    maxBudgetUsd: opts.maxBudgetUsd,
    taskBudgetTokens:
      opts.maxBudgetUsd !== undefined
        ? estimateTaskBudgetTokens(execTier, opts.maxBudgetUsd)
        : undefined,
    abortSignal: opts.abortSignal,
  });

  for await (const message of query({
    prompt: `Pursue the goal in the system prompt. Begin by re-reading the SPEC carefully, then act. Stop only when every completion condition is met or you are genuinely blocked.`,
    options: {
      model: execModel,
      fallbackModel,
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
      permissionMode: opts.permissionMode ?? "bypassPermissions",
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

  const parsed = parseGoalDriverOutput(finalResult);
  return {
    status: parsed.status,
    summary: parsed.summary,
    evidence: parsed.evidence,
    turns,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheWriteTokens,
    sessionId,
  };
}

export interface ParsedGoalOutput {
  readonly status: GoalRunResult["status"];
  readonly summary: string;
  readonly evidence: Record<string, string>;
}

const FINISHED_BLOCK = /FINISHED([\s\S]*?)(?:SUMMARY:|$)/;
const BLOCKED_BLOCK = /BLOCKED([\s\S]*)/;
const SUMMARY_LINE = /SUMMARY:\s*([\s\S]+)$/;
const EVIDENCE_LINE = /-\s*([\w-]+):\s*(.+)/;

export function parseGoalDriverOutput(raw: string): ParsedGoalOutput {
  const evidence: Record<string, string> = {};
  const finished = FINISHED_BLOCK.exec(raw);
  const blocked = BLOCKED_BLOCK.exec(raw);
  let status: GoalRunResult["status"] = "max-turns";
  let summary = raw.slice(0, 4000);
  if (finished) {
    status = "finished";
    for (const line of (finished[1] ?? "").split("\n")) {
      const m = EVIDENCE_LINE.exec(line.trim());
      if (m) evidence[m[1]!] = m[2]!;
    }
    const sumMatch = SUMMARY_LINE.exec(raw);
    if (sumMatch) summary = sumMatch[1]!.trim();
  } else if (blocked) {
    status = "blocked";
    summary = blocked[1]?.trim() ?? "";
  }
  return { status, summary, evidence };
}

// Native /goal wrapper — spawns `claude -p "/goal ..."` as a subprocess so the
// validator-loop runs inside Claude Code's built-in /goal command (v2.1.139+)
// instead of our custom driver. Opt-in via CMAX_USE_NATIVE_GOAL=1 or the
// runGoalNative() entry point. Custom driver remains the default until live
// API verification proves the native one matches behavior on real specs.
export async function runGoalNative(
  spec: Spec,
  opts: GoalRunOptions = {},
): Promise<GoalRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const maxTurns = opts.maxTurns ?? 200;
  const otel = buildOtelEnv({ agentId: undefined, parentAgentId: undefined });
  const env = { ...process.env, ...otel, ...(opts.env ?? {}) };

  const ccs = spec.completionConditions
    .map((c, i) => `${i + 1}. [${c.id}] ${c.description}\n   verify: ${c.verifyHint}`)
    .join("\n");
  const prompt = `/goal ${spec.goal}

Completion conditions (all must be satisfied):
${ccs}

When finished emit exactly:

FINISHED
- cc-id: <evidence>
SUMMARY: <one paragraph>

Or when blocked:

BLOCKED
REASON: <one sentence>
NEEDS: <what would unblock>`;

  const args = ["-p", prompt, "--dangerously-skip-permissions"];
  const started = Date.now();
  return new Promise((resolveP) => {
    const child = spawn("claude", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolveP({
          status: "max-turns",
          summary: `native /goal timed out after ${maxTurns * 60}s; stdout tail: ${stdout.slice(-500)}`,
          evidence: {},
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        });
      },
      maxTurns * 60_000,
    );
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = parseGoalDriverOutput(stdout);
      const summary = code === 0
        ? parsed.summary
        : `native /goal exit=${code}; stderr tail: ${stderr.slice(-500)} | stdout tail: ${stdout.slice(-500)}`;
      resolveP({
        status: code === 0 ? parsed.status : "blocked",
        summary,
        evidence: parsed.evidence,
        turns: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({
        status: "blocked",
        summary: `native /goal spawn error: ${err.message} (started=${started})`,
        evidence: {},
        turns: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    });
  });
}
