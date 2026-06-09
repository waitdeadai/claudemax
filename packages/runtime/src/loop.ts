import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MODELS,
  execModelForVariant,
  resolveBillingEra,
  modelById,
  decideNext,
  hasRepeatedFingerprint,
  hashString,
  type LoopAction,
  type LoopPass,
  type ModelId,
  type Spec,
  type VerificationReport,
} from "@claudemax/core";
import { runGoal, type GoalRunResult } from "./goal.js";
import { verify } from "./verify.js";
import { writeSpec } from "./spec-writer.js";
import type { EffortLevel } from "./sdk-options.js";

// Archetype A — the converge-loop made first-class (docs/LOOP_MODE_PLAN.md §6A).
// Drives one Spec to DONE via repeated fresh-context ITERATE→VERIFY passes, with
// the pure decideNext() state machine choosing continue / done / blocked / respec
// / stop. The loop BODY is the existing harness: runGoal (ITERATE) + verify
// (the independent, default-FAIL source of truth). Never trusts an executor's own
// "done" — only the blind verdict advances the loop. CLAUDE.md hard rules apply:
// verify always runs on Opus and is never demoted here.

export interface ConvergeLoopOptions {
  readonly cwd: string;
  readonly maxPasses?: number; // pass ceiling (default 6)
  readonly maxCreditUsd?: number; // credit ceiling across all passes (default 25)
  readonly maxTurnsPerPass?: number; // per-ITERATE turn cap (default 60)
  readonly respecAfterStuck?: number; // consecutive no-progress passes → respec (default 2)
  readonly maxRespecs?: number; // give up after this many respecs (default 2)
  readonly model?: ModelId; // ITERATE executor (default era-aware: Opus pre-split, Sonnet post-split)
  readonly effort?: EffortLevel;
  readonly env?: Record<string, string>;
  readonly stateDir?: string; // checkpoint dir (default .claudemax/state/loop)
  readonly abortSignal?: AbortSignal;
  readonly onPass?: (pass: LoopPass, action: LoopAction, reason: string) => void;
  // Injection points (production leaves undefined → live SDK). Tests pass fakes.
  readonly iterateFn?: (spec: Spec, remainingUsd: number) => Promise<GoalRunResult>;
  readonly verifyFn?: (spec: Spec) => Promise<VerificationReport>;
  // Respec rebuilds the Spec from the failing conditions. Undefined → the live
  // default (re-run the spec writer with the failure evidence appended).
  readonly respecFn?: (spec: Spec, failureEvidence: string) => Promise<Spec>;
}

export interface ConvergeLoopCheckpoint {
  readonly passes: readonly LoopPass[];
  readonly finalAction: LoopAction;
  readonly respecs: number;
  readonly totalCreditUsd: number;
  readonly ts: string;
}

export interface ConvergeLoopResult {
  readonly finalAction: LoopAction;
  readonly passes: readonly LoopPass[];
  readonly spec: Spec; // the (possibly respec'd) spec the loop finished on
  readonly lastReport: VerificationReport | null;
  readonly totalCreditUsd: number;
  readonly respecs: number;
}

const DEFAULT_MAX_PASSES = 6;
const DEFAULT_MAX_CREDIT_USD = 25;
const DEFAULT_MAX_TURNS_PER_PASS = 60;

export async function runConvergeLoop(
  inputSpec: Spec,
  opts: ConvergeLoopOptions,
): Promise<ConvergeLoopResult> {
  const maxPasses = posInt(opts.maxPasses, DEFAULT_MAX_PASSES);
  const maxCreditUsd = posNum(opts.maxCreditUsd, DEFAULT_MAX_CREDIT_USD);
  const maxTurnsPerPass = posInt(opts.maxTurnsPerPass, DEFAULT_MAX_TURNS_PER_PASS);
  // Era-aware executor default, same rule as cmax ask/run and the pipeline
  // loop: pre-split (until 2026-06-15) executes on Opus 4.8; Sonnet after.
  const execModel = opts.model ?? execModelForVariant("opussonnet", resolveBillingEra());

  const stateDir = opts.stateDir ?? join(opts.cwd, ".claudemax", "state", "loop");
  mkdirSync(stateDir, { recursive: true });
  const checkpointPath = join(stateDir, `${slug(inputSpec.title)}.converge.json`);

  const iterate =
    opts.iterateFn ??
    // remainingUsd is exposed to custom iterateFns, but the default does NOT forward
    // it as runGoal's maxBudgetUsd: that path derives a task_budget (the
    // task-budgets-2026-03-13 beta), which the current models reject with
    // "400 This model does not support user-configurable task budgets". The credit
    // ceiling is enforced one level up at decideNext() (stop-budget) from the
    // per-pass token accounting, so the per-pass SDK budget is redundant anyway.
    ((spec: Spec, _remainingUsd: number) =>
      runGoal(spec, {
        cwd: opts.cwd,
        model: execModel,
        maxTurns: maxTurnsPerPass,
        effort: opts.effort,
        env: opts.env,
        abortSignal: opts.abortSignal,
        // Fresh context per pass (Ralph-style, P3): no `resume` — each ITERATE
        // re-reads the SPEC + on-disk state rather than carrying a long, rotting
        // session. The verdict artifact, not session memory, is the continuity.
      }));

  const verifyFn =
    opts.verifyFn ??
    ((spec: Spec) =>
      verify(spec, {
        cwd: opts.cwd,
        env: opts.env,
        // verify stays on Opus (its own default) and writes the verdict artifact
        // the completion gate reads. Never demoted here.
      }));

  const respec =
    opts.respecFn ??
    ((spec: Spec, failureEvidence: string) =>
      writeSpec(
        `${spec.goal}\n\nThe previous spec did not converge. Failing-condition evidence:\n${failureEvidence}\nRewrite the spec with sharper, non-gameable completion conditions that address these failures.`,
        { cwd: opts.cwd },
      ));

  let spec = inputSpec;
  let respecs = 0;
  let totalCreditUsd = 0;
  const passes: LoopPass[] = [];
  let lastReport: VerificationReport | null = null;

  while (true) {
    const remainingUsd = maxCreditUsd - totalCreditUsd;
    const goal = await iterate(spec, remainingUsd);
    const creditThisPass = estimateUsd(goal.tokensIn, goal.tokensOut, execModel);
    totalCreditUsd += creditThisPass;

    const report = await verifyFn(spec);
    lastReport = report;

    const passedConditions = report.perCondition.filter(
      (f) => f.met && f.evidence.trim() !== "",
    ).length;
    const pass: LoopPass = {
      index: passes.length + 1,
      verdict: report.verdict,
      passedConditions,
      totalConditions: spec.completionConditions.length,
      blocked: goal.status === "blocked",
      fingerprint: reportFingerprint(report),
      creditUsd: creditThisPass,
    };
    passes.push(pass);

    const decision = decideNext({
      history: passes,
      budget: {
        maxPasses,
        maxCreditUsd,
        spentCreditUsd: totalCreditUsd,
        passCount: passes.length,
      },
      respecAfterStuck: opts.respecAfterStuck,
      respecCount: respecs,
      maxRespecs: opts.maxRespecs,
    });

    if (hasRepeatedFingerprint(passes)) {
      process.stderr.write(
        `  [loop] warning: repeated work fingerprint — the loop is spinning on the same state\n`,
      );
    }
    opts.onPass?.(pass, decision.action, decision.reason);
    writeCheckpoint(checkpointPath, { passes, finalAction: decision.action, respecs, totalCreditUsd, ts: new Date().toISOString() });

    if (decision.action === "iterate") continue;
    if (decision.action === "respec") {
      respecs += 1;
      const failureEvidence = report.perCondition
        .filter((f) => !f.met)
        .map((f) => `- [${f.id}] ${f.evidence}${f.actionableNext ? ` → ${f.actionableNext}` : ""}`)
        .join("\n");
      spec = await respec(spec, failureEvidence);
      continue;
    }

    return { finalAction: decision.action, passes, spec, lastReport, totalCreditUsd, respecs };
  }
}

// A condition-state signature: which conditions are met, plus the verdict. Repeats
// when the loop is stuck on the same partial state (drives the stall warning).
function reportFingerprint(report: VerificationReport): string {
  const state = report.perCondition
    .map((f) => `${f.id}:${f.met ? 1 : 0}`)
    .sort()
    .join(",");
  return hashString(`${report.verdict}|${state}`);
}

// Conservative cost estimate from the exec model's catalog pricing (auto-tracks
// the registry; ignores the cache-read discount, same as overnight.ts).
function estimateUsd(tokensIn: number, tokensOut: number, model: ModelId): number {
  const m = modelById(model);
  return (tokensIn / 1_000_000) * m.inputPer1MUsd + (tokensOut / 1_000_000) * m.outputPer1MUsd;
}

function writeCheckpoint(path: string, ck: ConvergeLoopCheckpoint): void {
  writeFileSync(path, JSON.stringify(ck, null, 2), "utf8");
}

export function readConvergeCheckpoint(
  cwd: string,
  title: string,
  stateDir?: string,
): ConvergeLoopCheckpoint | null {
  const dir = stateDir ?? join(cwd, ".claudemax", "state", "loop");
  const path = join(dir, `${slug(title)}.converge.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConvergeLoopCheckpoint;
  } catch {
    return null;
  }
}

function posInt(v: number | undefined, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}
function posNum(v: number | undefined, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}
function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
