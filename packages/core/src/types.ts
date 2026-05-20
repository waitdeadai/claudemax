export type ModelTier = "opus" | "sonnet" | "haiku";

export type ModelId =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

export type TaskClass =
  | "plan"
  | "architect"
  | "spec"
  | "verify"
  | "audit"
  | "debug-hard"
  | "implement"
  | "refactor"
  | "test"
  | "search"
  | "summarize"
  | "classify"
  | "route";

export type Plan = "max20x" | "max5x" | "pro" | "api";

export type BillingMode = "subscription" | "api";

export type ParallelMode = "auto" | "solo" | "teams";

export interface PlanInfo {
  readonly plan: Plan;
  readonly billing: BillingMode;
  readonly monthlyCreditUsd: number | null;
  readonly source: "auto-detect" | "env" | "config" | "default";
}

export interface TaskSignal {
  readonly class: TaskClass;
  readonly complexity: number;
  readonly novelty: number;
  readonly domain?: string;
  readonly priorFailure?: boolean;
  readonly explicitTier?: ModelTier;
  readonly summary: string;
}

export interface RouteDecision {
  readonly tier: ModelTier;
  readonly model: ModelId;
  readonly tools: readonly string[];
  readonly maxTurns: number;
  readonly reasoning: string;
  readonly escalated: boolean;
  readonly demoted: boolean;
  readonly estimatedCostUsd: number;
}

export interface SpecCompletionCondition {
  readonly id: string;
  readonly description: string;
  readonly verifyHint: string;
}

export interface Spec {
  readonly title: string;
  readonly goal: string;
  readonly nonGoals: readonly string[];
  readonly constraints: readonly string[];
  readonly completionConditions: readonly SpecCompletionCondition[];
  readonly assumptions: readonly string[];
  readonly evidenceRequired: readonly string[];
  readonly createdAt: string;
}

export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  readonly publishedAt?: string;
  readonly accessedAt: string;
  readonly relevance: number;
  readonly excerpt: string;
}

export interface ResearchBrief {
  readonly topic: string;
  readonly summary: string;
  readonly keyFindings: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly openQuestions: readonly string[];
  readonly createdAt: string;
}

export interface MultiSpec {
  readonly rootGoal: string;
  readonly researchBrief?: ResearchBrief;
  readonly subSpecs: readonly Spec[];
  readonly dependencies: readonly { readonly from: string; readonly to: string }[];
  readonly rollupCompletionConditions: readonly SpecCompletionCondition[];
  readonly writeSetByspecId: Readonly<Record<string, readonly string[]>>;
  readonly mode: ParallelMode;
  readonly modeReason: string;
  readonly createdAt: string;
}

export interface Packet {
  readonly id: string;
  readonly title: string;
  readonly signal: TaskSignal;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface DispatchPlan {
  readonly spec: Spec;
  readonly packets: readonly Packet[];
  readonly parallelGroups: readonly (readonly string[])[];
}

export interface AgentResult {
  readonly packetId: string;
  readonly success: boolean;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly tier: ModelTier;
}

export interface VerificationReport {
  readonly spec: Spec;
  readonly perCondition: readonly {
    readonly id: string;
    readonly met: boolean;
    readonly evidence: string;
  }[];
  readonly verdict: "verified" | "partial" | "failed";
  readonly verifierTier: ModelTier;
  readonly notes: string;
}

export interface MultiSpecVerification {
  readonly multispec: MultiSpec;
  readonly perSubSpec: readonly VerificationReport[];
  readonly rollup: VerificationReport;
  readonly verdict: "verified" | "partial" | "failed";
}
