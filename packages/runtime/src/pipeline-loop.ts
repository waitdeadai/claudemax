import {
  MODELS,
  modelById,
  decideNext,
  hashString,
  hasRepeatedFingerprint,
  type LoopAction,
  type LoopPass,
  type ModelId,
  type MultiSpec,
  type ResearchBrief,
  type Spec,
  type VerificationReport,
} from "@claudemax/core";
import { deepResearch } from "./deepresearch.js";
import { decomposeIntoMultiSpec } from "./multispec.js";
import { hardenSpec } from "./ssc.js";
import { runGoal, type GoalRunResult } from "./goal.js";
import { verify } from "./verify.js";
import type { EffortLevel } from "./sdk-options.js";

// The FAT loop body (docs/LOOP_MODE_PLAN.md §6/§7, "pipeline as loop body"). Where
// the converge-loop (loop.ts) drives a single hand-written spec, this loops the full
// effective `cmax ask` pipeline: deepresearch + multispec decompose happen ONCE in
// CONSTRUCT (re-researching every pass would be wasteful and rarely changes the
// answer), then ITERATE re-runs parallel /goal over the not-yet-finished sub-Specs
// and VERIFY runs the blind rollup verify — the convergence signal feeding the same
// pure decideNext() brain. RESPEC re-decomposes from the rollup's failing conditions.
// verify stays Opus and is never demoted (house rule #4).

export interface PipelineLoopOptions {
  readonly cwd: string;
  readonly research?: boolean; // run deepresearch in CONSTRUCT (default true)
  readonly ssc?: boolean; // harden sub-Specs before execution (default false)
  readonly adversarial?: boolean; // adversarial rollup verify (default false)
  readonly mvp?: boolean; // MVP bar instead of production-ready (default false)
  readonly maxPasses?: number; // pass ceiling (default 4 — the pipeline is heavy)
  readonly maxCreditUsd?: number; // credit ceiling across all passes (default 60)
  readonly maxTurnsPerSub?: number; // per-sub /goal turn cap (default 120)
  readonly respecAfterStuck?: number; // consecutive no-progress passes → respec (default 2)
  readonly maxRespecs?: number; // re-decompose is expensive; default 1
  readonly model?: ModelId; // sub-Spec executor (default Sonnet; Opus on --opusolo)
  readonly effort?: EffortLevel;
  readonly confidenceThreshold?: number; // rollup verify threshold (default 0.8)
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
  readonly onPhase?: (msg: string) => void;
  readonly onPass?: (pass: LoopPass, action: LoopAction, reason: string) => void;
  // Injection points (production leaves undefined → live SDK). Tests pass fakes.
  readonly researchFn?: (goal: string) => Promise<ResearchBrief | undefined>;
  readonly decomposeFn?: (goal: string, brief: ResearchBrief | undefined) => Promise<MultiSpec>;
  readonly goalFn?: (sub: Spec) => Promise<GoalRunResult>;
  readonly verifyRollupFn?: (root: Spec) => Promise<VerificationReport>;
}

export interface PipelineLoopResult {
  readonly finalAction: LoopAction;
  readonly passes: readonly LoopPass[];
  readonly multispec: MultiSpec;
  readonly rollup: VerificationReport | null;
  readonly totalCreditUsd: number;
  readonly respecs: number;
}

const DEFAULT_MAX_PASSES = 4;
const DEFAULT_MAX_CREDIT_USD = 60;
const DEFAULT_MAX_TURNS_PER_SUB = 120;
const DEFAULT_MAX_RESPECS = 1;

export async function runPipelineLoop(
  goal: string,
  opts: PipelineLoopOptions,
): Promise<PipelineLoopResult> {
  const maxPasses = posInt(opts.maxPasses, DEFAULT_MAX_PASSES);
  const maxCreditUsd = posNum(opts.maxCreditUsd, DEFAULT_MAX_CREDIT_USD);
  const maxTurnsPerSub = posInt(opts.maxTurnsPerSub, DEFAULT_MAX_TURNS_PER_SUB);
  const maxRespecs = opts.maxRespecs ?? DEFAULT_MAX_RESPECS;
  const execModel = opts.model ?? MODELS.sonnet.id;
  const research = opts.research ?? true;
  const phase = opts.onPhase ?? (() => {});

  const researchFn =
    opts.researchFn ?? (async (g: string) => (research ? deepResearch(g, { cwd: opts.cwd }) : undefined));
  const decomposeFn =
    opts.decomposeFn ??
    ((g: string, brief: ResearchBrief | undefined) =>
      decomposeIntoMultiSpec(g, { cwd: opts.cwd, researchBrief: brief, mvp: opts.mvp }));
  const goalFn =
    opts.goalFn ??
    ((sub: Spec) =>
      runGoal(sub, {
        cwd: opts.cwd,
        model: execModel,
        maxTurns: maxTurnsPerSub,
        effort: opts.effort,
        env: opts.env,
        abortSignal: opts.abortSignal,
      }));
  const verifyRollupFn =
    opts.verifyRollupFn ??
    ((root: Spec) =>
      verify(root, {
        cwd: opts.cwd,
        env: opts.env,
        confidenceThreshold: opts.confidenceThreshold,
        adversarial: opts.adversarial,
      }));

  // CONSTRUCT (once): deepresearch → decompose → (optional) SSC harden.
  if (research) phase("construct: deepresearch");
  const brief = await researchFn(goal);
  phase("construct: multispec decompose");
  let multispec = await decomposeFn(goal, brief);
  if (opts.ssc) {
    phase("construct: SSC harden sub-Specs");
    const hardened = await Promise.all(
      multispec.subSpecs.map(async (s) => (await hardenSpec(s, { cwd: opts.cwd, effort: opts.effort })).hardened),
    );
    multispec = { ...multispec, subSpecs: hardened };
  }

  let respecs = 0;
  let totalCreditUsd = 0;
  const passes: LoopPass[] = [];
  let rollup: VerificationReport | null = null;
  // Frontier: sub-Spec ids whose executor last claimed "finished". Used only to
  // decide what to RE-RUN — never to declare done. The rollup verify is the gate.
  let finishedIds = new Set<string>();

  while (true) {
    const rootSpec = rootSpecOf(multispec);
    const pending = multispec.subSpecs.filter((s) => !finishedIds.has(subId(s)));
    const runList = pending.length ? pending : multispec.subSpecs; // gate contradicted claims → redo all

    // ITERATE: parallel /goal over the frontier.
    phase(`iterate: /goal x ${runList.length}`);
    let creditThisPass = 0;
    const results = await Promise.all(runList.map((s) => goalFn(s)));
    runList.forEach((s, i) => {
      const r = results[i]!;
      creditThisPass += estimateUsd(r.tokensIn, r.tokensOut, execModel);
      if (r.status === "finished") finishedIds.add(subId(s));
    });
    totalCreditUsd += creditThisPass;
    const anyBlocked = results.some((r) => r.status === "blocked");

    // VERIFY: blind rollup verify is the convergence signal.
    phase("verify: rollup (blind Opus)");
    rollup = await verifyRollupFn(rootSpec);
    const passedConditions = rollup.perCondition.filter((f) => f.met && f.evidence.trim() !== "").length;

    const pass: LoopPass = {
      index: passes.length + 1,
      verdict: rollup.verdict,
      passedConditions,
      totalConditions: rootSpec.completionConditions.length,
      blocked: anyBlocked && rollup.verdict !== "verified",
      fingerprint: rollupFingerprint(rollup),
      creditUsd: creditThisPass,
    };
    passes.push(pass);

    const decision = decideNext({
      history: passes,
      budget: { maxPasses, maxCreditUsd, spentCreditUsd: totalCreditUsd, passCount: passes.length },
      respecAfterStuck: opts.respecAfterStuck,
      respecCount: respecs,
      maxRespecs,
    });
    if (hasRepeatedFingerprint(passes)) {
      process.stderr.write(`  [pipeline-loop] warning: rollup state unchanged — spinning on the same conditions\n`);
    }
    opts.onPass?.(pass, decision.action, decision.reason);

    if (decision.action === "iterate") {
      // If the executor claims everything finished but the gate disagrees, the
      // claims are wrong — reset the frontier so the next pass re-runs all.
      if (!pending.length) finishedIds = new Set();
      continue;
    }
    if (decision.action === "respec") {
      respecs += 1;
      phase("respec: re-decompose from failing conditions");
      const failures = rollup.perCondition
        .filter((f) => !f.met)
        .map((f) => `- [${f.id}] ${f.evidence}${f.actionableNext ? ` -> ${f.actionableNext}` : ""}`)
        .join("\n");
      multispec = await decomposeFn(
        `${goal}\n\nThe previous decomposition did not converge. Rollup failures:\n${failures}\nRe-decompose with sub-Specs that directly close these gaps and sharper, non-gameable rollup conditions.`,
        brief,
      );
      finishedIds = new Set();
      continue;
    }

    return { finalAction: decision.action, passes, multispec, rollup, totalCreditUsd, respecs };
  }
}

function rootSpecOf(multispec: MultiSpec): Spec {
  return {
    title: multispec.rootGoal,
    goal: multispec.rootGoal,
    nonGoals: [],
    constraints: [],
    completionConditions: multispec.rollupCompletionConditions,
    assumptions: [],
    evidenceRequired: [],
    createdAt: multispec.createdAt,
  };
}

function rollupFingerprint(report: VerificationReport): string {
  const state = report.perCondition
    .map((f) => `${f.id}:${f.met ? 1 : 0}`)
    .sort()
    .join(",");
  return hashString(`${report.verdict}|${state}`);
}

function estimateUsd(tokensIn: number, tokensOut: number, model: ModelId): number {
  const m = modelById(model);
  return (tokensIn / 1_000_000) * m.inputPer1MUsd + (tokensOut / 1_000_000) * m.outputPer1MUsd;
}

function subId(s: Spec): string {
  return s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function posInt(v: number | undefined, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}
function posNum(v: number | undefined, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}
