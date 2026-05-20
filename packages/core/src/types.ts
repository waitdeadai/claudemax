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

export type InteractiveVerifyTool = "playwright" | "browser" | "shell";

export interface InteractiveVerifyHint {
  readonly tool: InteractiveVerifyTool;
  readonly script: string;
  readonly timeoutMs?: number;
  readonly expect?: string;
}

export interface SpecCompletionCondition {
  readonly id: string;
  readonly description: string;
  readonly verifyHint: string;
  readonly interactive?: InteractiveVerifyHint;
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
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly tier: ModelTier;
}

export type FailureCategory =
  | "missing-file"
  | "test-failure"
  | "build-error"
  | "type-error"
  | "behavior-mismatch"
  | "incomplete-implementation"
  | "regression"
  | "spec-ambiguity"
  | "interactive-failure"
  | "unknown";

export interface VerificationFinding {
  readonly id: string;
  readonly met: boolean;
  readonly evidence: string;
  readonly confidence: number;
  readonly failureCategory?: FailureCategory;
  readonly actionableNext?: string;
  readonly consolidatedFrom?: readonly string[];
}

export interface VerificationReport {
  readonly spec: Spec;
  readonly perCondition: readonly VerificationFinding[];
  readonly suppressedLowConfidence: readonly VerificationFinding[];
  readonly verdict: "verified" | "partial" | "failed";
  readonly verifierTier: ModelTier;
  readonly notes: string;
  readonly confidenceThreshold: number;
}

export interface MultiSpecVerification {
  readonly multispec: MultiSpec;
  readonly perSubSpec: readonly VerificationReport[];
  readonly rollup: VerificationReport;
  readonly verdict: "verified" | "partial" | "failed";
}

export type MultiSpecPhase =
  | "deepresearch"
  | "decompose"
  | "specqa"
  | "introspect"
  | "goal"
  | "verify-per-spec"
  | "verify-rollup";

export interface PhaseHandoff {
  readonly phase: MultiSpecPhase;
  readonly previousPhase?: MultiSpecPhase;
  readonly rootGoal: string;
  readonly summary: string;
  readonly nextInputs: readonly string[];
  readonly blockers: readonly string[];
  readonly artifacts: Readonly<Record<string, string>>;
  readonly createdAt: string;
}
