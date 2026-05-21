import { MODELS } from "./models.js";
import { budgetTag, estimatePacketCost } from "./cost.js";
import { resolveBillingEra } from "./cost.js";
import type { BillingEra } from "./types.js";
import type {
  ModelTier,
  Plan,
  RouteDecision,
  TaskClass,
  TaskSignal,
} from "./types.js";

const BASELINE_TIER: Readonly<Record<TaskClass, ModelTier>> = {
  plan: "opus",
  architect: "opus",
  spec: "opus",
  verify: "opus",
  audit: "opus",
  "debug-hard": "opus",
  implement: "sonnet",
  refactor: "sonnet",
  test: "sonnet",
  search: "haiku",
  summarize: "haiku",
  classify: "haiku",
  route: "haiku",
};

const BASELINE_TOOLS: Readonly<Record<TaskClass, readonly string[]>> = {
  plan: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  architect: ["Read", "Glob", "Grep"],
  spec: ["Read", "Glob", "Grep", "WebSearch"],
  verify: ["Read", "Glob", "Grep", "Bash"],
  audit: ["Read", "Glob", "Grep"],
  "debug-hard": ["Read", "Edit", "Bash", "Glob", "Grep"],
  implement: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  refactor: ["Read", "Edit", "Glob", "Grep", "Bash"],
  test: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  search: ["Read", "Glob", "Grep"],
  summarize: ["Read", "Glob", "Grep"],
  classify: [],
  route: [],
};

const BASELINE_MAX_TURNS: Readonly<Record<TaskClass, number>> = {
  plan: 25,
  architect: 25,
  spec: 20,
  verify: 30,
  audit: 25,
  "debug-hard": 60,
  implement: 80,
  refactor: 60,
  test: 50,
  search: 15,
  summarize: 10,
  classify: 5,
  route: 5,
};

const SECURITY_DOMAINS = new Set([
  "auth",
  "authentication",
  "authorization",
  "crypto",
  "payments",
  "billing",
  "secrets",
  "session",
]);

const NEVER_DEMOTE: ReadonlySet<TaskClass> = new Set([
  "verify",
  "spec",
  "architect",
]);

export interface RouterOptions {
  readonly explicitTier?: ModelTier;
  readonly costCeilingUsd?: number;
  readonly forceCheap?: boolean;
  readonly plan?: Plan;
  readonly creditConsumedUsd?: number;
  // Defaults to resolveBillingEra() which returns "pre-split" before 2026-06-15
  // and "post-split" after. In pre-split era the plan-budget demote path is a
  // no-op because the monthly Agent SDK credit envelope doesn't exist yet.
  readonly era?: BillingEra;
}

export function route(signal: TaskSignal, opts: RouterOptions = {}): RouteDecision {
  const baseline = BASELINE_TIER[signal.class];
  let tier: ModelTier = baseline;
  const reasons: string[] = [`baseline ${signal.class}→${baseline}`];
  let escalated = false;
  let demoted = false;

  if (opts.explicitTier) {
    tier = opts.explicitTier;
    reasons.push(`explicit override→${tier}`);
  } else if (signal.explicitTier) {
    tier = signal.explicitTier;
    reasons.push(`signal explicit→${tier}`);
  } else {
    if (tier !== "opus") {
      if (signal.complexity >= 7) {
        tier = "opus";
        escalated = true;
        reasons.push(`complexity=${signal.complexity}≥7→opus`);
      } else if (signal.novelty >= 8) {
        tier = "opus";
        escalated = true;
        reasons.push(`novelty=${signal.novelty}≥8→opus`);
      } else if (signal.priorFailure) {
        tier = "opus";
        escalated = true;
        reasons.push(`prior-failure→opus`);
      } else if (signal.domain && SECURITY_DOMAINS.has(signal.domain.toLowerCase())) {
        tier = "opus";
        escalated = true;
        reasons.push(`security-domain=${signal.domain}→opus`);
      }
    }
  }

  if (
    opts.forceCheap &&
    tier === "opus" &&
    !NEVER_DEMOTE.has(signal.class)
  ) {
    tier = "sonnet";
    demoted = true;
    reasons.push(`forceCheap & not-never-demote→sonnet`);
  }

  if (opts.plan && opts.creditConsumedUsd != null && tier === "opus" && !NEVER_DEMOTE.has(signal.class)) {
    const era = opts.era ?? resolveBillingEra();
    const tag = budgetTag(opts.plan, opts.creditConsumedUsd, era);
    if (tag === "danger" || tag === "blocked") {
      const sonnetEst = estimatePacketCost("sonnet", signal.complexity);
      tier = "sonnet";
      demoted = true;
      reasons.push(`plan-budget=${tag} (consumed=${opts.creditConsumedUsd.toFixed(2)})→sonnet ($${sonnetEst.toFixed(3)})`);
    } else if (tag === "guard") {
      const sonnetEst = estimatePacketCost("sonnet", signal.complexity);
      tier = "sonnet";
      demoted = true;
      reasons.push(`plan-budget=guard (≥70%)→sonnet ($${sonnetEst.toFixed(3)})`);
    }
  }

  const estCostNow = estimatePacketCost(tier, signal.complexity);
  if (
    opts.costCeilingUsd != null &&
    estCostNow > opts.costCeilingUsd &&
    tier === "opus" &&
    !NEVER_DEMOTE.has(signal.class)
  ) {
    const sonnetEst = estimatePacketCost("sonnet", signal.complexity);
    if (sonnetEst <= opts.costCeilingUsd) {
      tier = "sonnet";
      demoted = true;
      reasons.push(`cost-ceiling=$${opts.costCeilingUsd.toFixed(2)} < opus=$${estCostNow.toFixed(2)}→sonnet=$${sonnetEst.toFixed(2)}`);
    }
  }

  return {
    tier,
    model: MODELS[tier].id,
    tools: BASELINE_TOOLS[signal.class],
    maxTurns: BASELINE_MAX_TURNS[signal.class],
    reasoning: reasons.join("; "),
    escalated,
    demoted,
    estimatedCostUsd: estimatePacketCost(tier, signal.complexity),
  };
}

export function classifyHeuristic(summary: string): TaskClass {
  const s = summary.toLowerCase();
  if (/\b(verify|verification|supervisor|check.*spec)\b/.test(s)) return "verify";
  if (/\b(audit|review.*code|inspect)\b/.test(s)) return "audit";
  if (/\b(spec|completion condition|contract)\b/.test(s)) return "spec";
  if (/\b(architect|design.*system|multi-?file|cross-?cutting)\b/.test(s)) return "architect";
  if (/\b(plan|break down|decompose)\b/.test(s)) return "plan";
  if (/\b(debug|investigate.*fail|root cause|flaky)\b/.test(s)) return "debug-hard";
  if (/\b(refactor|rename|extract|inline)\b/.test(s)) return "refactor";
  if (/\b(tests?|fixtures?|snapshots?)\b/.test(s)) return "test";
  if (/\b(search|grep|find references|locate)\b/.test(s)) return "search";
  if (/\b(summari[sz]e|tl;?dr|condense)\b/.test(s)) return "summarize";
  if (/\b(classify|label|categori[sz]e)\b/.test(s)) return "classify";
  return "implement";
}
