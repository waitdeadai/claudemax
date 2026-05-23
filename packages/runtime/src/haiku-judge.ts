import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { budgetTag, type BudgetTag, type Plan } from "@claudemax/core";
import { extractStructuredOutput } from "./sdk-options.js";

// Canonical Haiku 4.5 model id used by the Tier-3 judge. The bare "-4-5"
// alias points at the current Haiku 4.5 family without pinning to a dated
// snapshot, so the cascade picks up patch revisions automatically.
export const HAIKU_MODEL_ID = "claude-haiku-4-5";

export type JudgeAction = "BLOCK" | "REDACT" | "WARN" | "LOG";

export interface JudgeInput {
  readonly content: string;
  readonly context?: string;
  readonly categories?: readonly string[];
  readonly hookName?: string;
  readonly plan?: Plan;
  readonly consumedUsd?: number;
}

export interface JudgeVerdict {
  readonly action: JudgeAction;
  readonly reason: string;
  readonly latencyMs: number;
  readonly model: string;
  readonly confidence: number;
  readonly tier: "haiku" | "fallback";
  readonly category?: string;
}

export interface JudgeOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly abortSignal?: AbortSignal;
  // Injection point for tests. Production callers leave this undefined and the
  // judge uses the live SDK query() export. Tests pass a stub to avoid network.
  readonly queryFn?: typeof sdkQuery;
}

const VERDICT_SCHEMA = {
  type: "object",
  required: ["action", "reason", "confidence"],
  properties: {
    action: { type: "string", enum: ["BLOCK", "REDACT", "WARN", "LOG"] },
    reason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    category: { type: "string" },
  },
} as const;

const JUDGE_SYSTEM = `You are the Tier-3 Haiku judge in claudemax's tiered validation cascade.

You receive content that Tier-1 (regex) and Tier-2 (deterministic scorer) found ambiguous.
Render a verdict with one of four actions:
  - BLOCK   : content violates a hard rule; stop the agent
  - REDACT  : content has a fixable problem; suggest a rewrite
  - WARN    : suspicious but not blocking; surface to the user
  - LOG     : benign; record for telemetry only

Output structured JSON: { action, reason, confidence (0..1), category? }.
Be terse. Reason is one short sentence.`;

// Budget tags above "ok" mean the monthly Agent SDK credit pool is >=70%
// consumed. The Tier-3 judge is opt-in escalation only — when budget pressure
// is real, skip Haiku and let the caller's pre-existing verdict stand.
function shouldSkipForBudget(tag: BudgetTag): boolean {
  return tag !== "ok";
}

function isValidVerdict(v: unknown): v is {
  action: JudgeAction;
  reason: string;
  confidence: number;
  category?: string;
} {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["action"] === "string" &&
    ["BLOCK", "REDACT", "WARN", "LOG"].includes(o["action"] as string) &&
    typeof o["reason"] === "string" &&
    typeof o["confidence"] === "number"
  );
}

export async function judgeWithHaiku(
  input: JudgeInput,
  opts: JudgeOptions = {},
): Promise<JudgeVerdict> {
  const start = Date.now();

  if (input.plan && input.consumedUsd != null) {
    const tag = budgetTag(input.plan, input.consumedUsd);
    if (shouldSkipForBudget(tag)) {
      return {
        action: "LOG",
        reason: "budget_gate_skipped",
        latencyMs: Date.now() - start,
        model: HAIKU_MODEL_ID,
        confidence: 0,
        tier: "fallback",
      };
    }
  }

  const userMsg = [
    input.hookName ? `Hook: ${input.hookName}` : null,
    input.categories?.length ? `Categories of concern: ${input.categories.join(", ")}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Content to judge:\n${input.content}`,
    `Return the JSON verdict object.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const q = opts.queryFn ?? sdkQuery;

  try {
    let structured: Record<string, unknown> | null = null;
    for await (const message of q({
      prompt: userMsg,
      options: {
        model: HAIKU_MODEL_ID,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: JUDGE_SYSTEM,
        },
        allowedTools: [],
        permissionMode: "bypassPermissions",
        maxTurns: opts.maxTurns ?? 2,
        cwd: opts.cwd,
        settingSources: ["user", "project"],
        outputFormat: { type: "json_schema", schema: VERDICT_SCHEMA },
      } as never,
    })) {
      if (!structured) structured = extractStructuredOutput(message);
    }

    const latencyMs = Date.now() - start;
    if (isValidVerdict(structured)) {
      return {
        action: structured.action,
        reason: structured.reason,
        latencyMs,
        model: HAIKU_MODEL_ID,
        confidence: structured.confidence,
        tier: "haiku",
        ...(structured.category ? { category: structured.category } : {}),
      };
    }
    return {
      action: "LOG",
      reason: "haiku_unavailable",
      latencyMs,
      model: HAIKU_MODEL_ID,
      confidence: 0,
      tier: "fallback",
    };
  } catch {
    return {
      action: "LOG",
      reason: "haiku_unavailable",
      latencyMs: Date.now() - start,
      model: HAIKU_MODEL_ID,
      confidence: 0,
      tier: "fallback",
    };
  }
}
