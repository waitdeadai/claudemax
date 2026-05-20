import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MODELS,
  estimatePacketCost,
  route,
  type AgentResult,
  type DispatchPlan,
  type Packet,
  type Plan,
} from "@claudemax/core";
import { PACKET_AGENT_SYSTEM } from "./prompts.js";
import { baseSdkOptions, parseUsageWithCache, type EffortLevel } from "./sdk-options.js";

export interface DispatchOptions {
  readonly cwd?: string;
  readonly costCeilingUsd?: number;
  readonly maxParallel?: number;
  readonly onPacketStart?: (p: Packet) => void;
  readonly onPacketEnd?: (r: AgentResult) => void;
  readonly permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  readonly env?: Record<string, string>;
  readonly plan?: Plan;
  readonly creditConsumedUsd?: number;
  readonly effort?: EffortLevel;
}

export interface ParallelCap {
  readonly hardware: number;
  readonly creditAware: number | null;
  readonly effective: number;
  readonly reason: string;
}

export function computeParallelCap(opts: {
  readonly plan?: Plan;
  readonly remainingCreditUsd?: number;
  readonly perPacketCostEstimateUsd?: number;
  readonly override?: number;
}): ParallelCap {
  const hardware = detectHardwareCap();
  if (opts.override != null) {
    return {
      hardware,
      creditAware: null,
      effective: Math.min(opts.override, hardware),
      reason: `override=${opts.override} (hw cap=${hardware})`,
    };
  }
  let creditAware: number | null = null;
  if (
    opts.plan &&
    opts.plan !== "api" &&
    opts.remainingCreditUsd != null &&
    opts.perPacketCostEstimateUsd != null &&
    opts.perPacketCostEstimateUsd > 0
  ) {
    creditAware = Math.max(
      1,
      Math.floor((opts.remainingCreditUsd / opts.perPacketCostEstimateUsd) * 0.3),
    );
  }
  const effective = creditAware != null ? Math.min(hardware, creditAware) : hardware;
  return {
    hardware,
    creditAware,
    effective,
    reason: `hw=${hardware}${creditAware != null ? ` credit-aware=${creditAware} (30% of remaining/per-packet)` : ""}`,
  };
}

function detectHardwareCap(): number {
  try {
    const os = require("node:os") as { cpus(): { length: number }[] };
    const cpus = os.cpus()?.length ?? 4;
    if (cpus >= 16) return 10;
    if (cpus >= 8) return 6;
    return 3;
  } catch {
    return 3;
  }
}

async function runPacket(
  packet: Packet,
  specGoal: string,
  opts: DispatchOptions,
): Promise<AgentResult> {
  const decision = route(packet.signal, {
    costCeilingUsd: opts.costCeilingUsd,
    plan: opts.plan,
    creditConsumedUsd: opts.creditConsumedUsd,
  });
  const started = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let summary = "";
  const evidence: string[] = [];
  let success = false;

  const base = baseSdkOptions({
    cwd: opts.cwd,
    env: opts.env,
    maxTurns: decision.maxTurns,
    effort: opts.effort,
    // Opus 4.7 ships "fewer subagents spawned by default"; nudge adaptive thinking
    // for routes that escalate to opus so the model reasons before calling tools.
    thinking: decision.tier === "opus" ? "adaptive" : undefined,
  });

  try {
    for await (const message of query({
      prompt: `Execute packet: ${packet.title}\n\nInputs:\n${packet.inputs.map((i) => "- " + i).join("\n") || "(none)"}\n\nExpected outputs:\n${packet.outputs.map((o) => "- " + o).join("\n") || "(none)"}`,
      options: {
        model: decision.model,
        fallbackModel: MODELS.sonnet.id,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: PACKET_AGENT_SYSTEM(packet.title, specGoal),
        },
        allowedTools: [...decision.tools],
        permissionMode: opts.permissionMode ?? "default",
        ...base,
      } as never,
    })) {
      const m = message as { type?: string; subtype?: string; result?: string; usage?: unknown };
      if (m.type === "result" && typeof m.result === "string") {
        summary = m.result;
        if (m.usage) {
          const stats = parseUsageWithCache(m.usage);
          tokensIn += stats.inputTokens;
          tokensOut += stats.outputTokens;
          cacheReadTokens += stats.cacheReadTokens;
          cacheWriteTokens += stats.cacheWrite5mTokens + stats.cacheWrite1hTokens;
        }
        const ev = /EVIDENCE:\s*([\s\S]*?)(?:STATUS:|$)/.exec(m.result);
        if (ev?.[1]) {
          for (const line of ev[1].split("\n")) {
            const t = line.trim();
            if (t.startsWith("- ")) evidence.push(t.slice(2));
          }
        }
        const st = /STATUS:\s*(success|partial|blocked)/.exec(m.result);
        success = st?.[1] === "success";
      }
    }
  } catch (err) {
    summary = `worker error: ${(err as Error).message}`;
    success = false;
  }

  const durationMs = Date.now() - started;
  const costUsd = estimatePacketCost(decision.tier, packet.signal.complexity);
  return {
    packetId: packet.id,
    success,
    summary,
    evidence,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
    durationMs,
    tier: decision.tier,
  };
}

export async function dispatch(
  plan: DispatchPlan,
  opts: DispatchOptions = {},
): Promise<readonly AgentResult[]> {
  const perPacketEstimate =
    plan.packets.reduce((acc, p) => acc + estimatePacketCost("sonnet", p.signal.complexity), 0) /
    Math.max(1, plan.packets.length);
  const cap = computeParallelCap({
    plan: opts.plan,
    remainingCreditUsd:
      opts.plan && opts.plan !== "api" && opts.creditConsumedUsd != null
        ? Math.max(0, (opts.plan === "max20x" ? 200 : opts.plan === "max5x" ? 100 : 20) - opts.creditConsumedUsd)
        : undefined,
    perPacketCostEstimateUsd: perPacketEstimate,
    override: opts.maxParallel,
  });

  const results: AgentResult[] = [];

  for (const group of plan.parallelGroups) {
    const packets = group
      .map((id) => plan.packets.find((p) => p.id === id))
      .filter((p): p is Packet => Boolean(p));

    for (let i = 0; i < packets.length; i += cap.effective) {
      const slice = packets.slice(i, i + cap.effective);
      const promises = slice.map(async (p) => {
        opts.onPacketStart?.(p);
        const r = await runPacket(p, plan.spec.goal, opts);
        opts.onPacketEnd?.(r);
        return r;
      });
      const batch = await Promise.all(promises);
      results.push(...batch);
    }
  }

  return results;
}

export function summarizeDispatch(results: readonly AgentResult[]): {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  successCount: number;
  failureCount: number;
  byTier: Record<string, number>;
} {
  const byTier: Record<string, number> = {};
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let successCount = 0;
  let failureCount = 0;
  for (const r of results) {
    totalCostUsd += r.costUsd;
    totalTokensIn += r.tokensIn;
    totalTokensOut += r.tokensOut;
    if (r.success) successCount++;
    else failureCount++;
    byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  }
  return { totalCostUsd, totalTokensIn, totalTokensOut, successCount, failureCount, byTier };
}

export const MODEL_TABLE = MODELS;
