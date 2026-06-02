// cmax eval — the measurement keystone (§6). Without a number you cannot tell
// whether any of the anti-gaming machinery actually works. This harness runs a
// private task set through the pipeline and reports the metric that matters:
//
//   production-hotfix-rate = of the tasks the harness CLAIMED done ("verified"),
//   the fraction that a hidden post-"done" check then found broken. That is the
//   user's exact pain — "says done, breaks in prod" — quantified.
//
// Plus the verifier false-positive rate (vs a human spot-check) and an ablation
// matrix (full vs no-verify / no-ssc / no-adversarial) so each piece's delta is
// measurable. The metric math + runner are pure / injectable (tested here); the
// default deps drive the real `cmax run` subprocess.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VerdictValue } from "./verdict-artifact.js";

export interface EvalCase {
  readonly id: string;
  readonly goal: string;
  readonly kind?: "code" | "frontend" | "research";
  // Workdir the pipeline runs in (a repo/sandbox). Defaults to process.cwd().
  readonly cwd?: string;
  // Hidden checks run AFTER the harness says "done" — a non-zero exit is a defect
  // the pipeline's own verify missed (the production-hotfix proxy).
  readonly hiddenChecks?: readonly string[];
  // Optional human spot-check label, for the verifier false-positive rate.
  readonly humanVerdict?: "pass" | "fail";
}

export interface Ablation {
  readonly label: string;
  readonly verify?: boolean;
  readonly ssc?: boolean;
  readonly adversarial?: boolean;
  readonly mvp?: boolean;
}

export const STANDARD_ABLATIONS: readonly Ablation[] = [
  { label: "full", verify: true, ssc: true, adversarial: true },
  { label: "no-verify", verify: false },
  { label: "no-ssc", verify: true, ssc: false, adversarial: true },
  { label: "no-adversarial", verify: true, ssc: true, adversarial: false },
];

export interface EvalOutcome {
  readonly caseId: string;
  readonly pipelineVerdict: VerdictValue; // what the harness CLAIMED
  readonly hotfixDefects: number; // hidden checks that failed after "done"
  readonly humanVerdict?: "pass" | "fail";
  readonly tokensOut?: number;
  readonly durationMs?: number;
}

export interface EvalMetrics {
  readonly n: number;
  readonly claimedDone: number;
  // of claimedDone, the fraction with >=1 hidden defect surfacing after "done".
  readonly productionHotfixRate: number;
  // of cases a human judged "fail", the fraction the pipeline marked "verified".
  readonly verifierFalsePositiveRate: number;
  readonly verdictBreakdown: Readonly<Record<string, number>>;
}

export function computeEvalMetrics(outcomes: readonly EvalOutcome[]): EvalMetrics {
  const n = outcomes.length;
  const done = outcomes.filter((o) => o.pipelineVerdict === "verified");
  const hotfixed = done.filter((o) => o.hotfixDefects > 0);
  const humanFails = outcomes.filter((o) => o.humanVerdict === "fail");
  const falsePositives = humanFails.filter((o) => o.pipelineVerdict === "verified");
  const verdictBreakdown: Record<string, number> = {};
  for (const o of outcomes) verdictBreakdown[o.pipelineVerdict] = (verdictBreakdown[o.pipelineVerdict] ?? 0) + 1;
  return {
    n,
    claimedDone: done.length,
    productionHotfixRate: done.length === 0 ? 0 : hotfixed.length / done.length,
    verifierFalsePositiveRate: humanFails.length === 0 ? 0 : falsePositives.length / humanFails.length,
    verdictBreakdown,
  };
}

export interface EvalDeps {
  readonly runPipeline: (
    c: EvalCase,
    ablation: Ablation,
  ) => Promise<{ verdict: VerdictValue; tokensOut?: number; durationMs?: number }>;
  // Returns the number of hidden checks that FAILED (non-zero exit). Optional —
  // a case with no hiddenChecks contributes 0 to the hotfix rate.
  readonly runHiddenChecks?: (c: EvalCase) => Promise<number>;
}

export interface EvalRunResult {
  readonly ablation: string;
  readonly outcomes: readonly EvalOutcome[];
  readonly metrics: EvalMetrics;
}

export async function runEval(
  cases: readonly EvalCase[],
  deps: EvalDeps,
  ablation: Ablation,
): Promise<EvalRunResult> {
  const outcomes: EvalOutcome[] = [];
  for (const c of cases) {
    const r = await deps.runPipeline(c, ablation);
    const hotfixDefects =
      c.hiddenChecks && c.hiddenChecks.length && deps.runHiddenChecks
        ? await deps.runHiddenChecks(c)
        : 0;
    outcomes.push({
      caseId: c.id,
      pipelineVerdict: r.verdict,
      hotfixDefects,
      ...(c.humanVerdict ? { humanVerdict: c.humanVerdict } : {}),
      ...(r.tokensOut !== undefined ? { tokensOut: r.tokensOut } : {}),
      ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}),
    });
  }
  return { ablation: ablation.label, outcomes, metrics: computeEvalMetrics(outcomes) };
}

export async function runAblations(
  cases: readonly EvalCase[],
  deps: EvalDeps,
  ablations: readonly Ablation[] = STANDARD_ABLATIONS,
): Promise<readonly EvalRunResult[]> {
  const results: EvalRunResult[] = [];
  for (const ab of ablations) results.push(await runEval(cases, deps, ab));
  return results;
}

// Render an ablation comparison the user can read at a glance. Lower hotfix-rate
// is better; the delta from "full" to each ablation shows what each piece buys.
export function renderAblationReport(results: readonly EvalRunResult[]): string {
  const lines = ["ablation         n   done   hotfix-rate   verifier-FP-rate"];
  for (const r of results) {
    const m = r.metrics;
    lines.push(
      `${r.ablation.padEnd(15)} ${String(m.n).padStart(2)}   ${String(m.claimedDone).padStart(3)}    ${(m.productionHotfixRate * 100).toFixed(0).padStart(7)}%      ${(m.verifierFalsePositiveRate * 100).toFixed(0).padStart(9)}%`,
    );
  }
  return lines.join("\n");
}

// ── Default (real) deps: drive the locally-built cmax CLI + shell hidden checks ──

function cliEntry(): string {
  // runtime dist lives at packages/runtime/dist/; the CLI entry is at
  // packages/cli/dist/index.js. Resolve relative to this compiled module.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "dist", "index.js");
}

export function defaultEvalDeps(): EvalDeps {
  const entry = cliEntry();
  return {
    runPipeline: async (c, ablation) => {
      const cwd = c.cwd ?? process.cwd();
      const args = ["run", c.goal, "--no-research"];
      if (ablation.verify === false) args.push("--no-verify");
      if (ablation.ssc) args.push("--ssc");
      if (ablation.adversarial) args.push("--adversarial");
      if (ablation.mvp) args.push("--mvp");
      const started = Date.now();
      spawnSync(process.execPath, [entry, ...args], {
        cwd,
        encoding: "utf8",
        stdio: "inherit",
        env: process.env,
      });
      const durationMs = Date.now() - started;
      // The rollup verify writes verdict-latest.json last; read its gate.
      const verdictPath = join(cwd, ".claudemax", "state", "verdict-latest.json");
      let verdict: VerdictValue = "unverified";
      if (existsSync(verdictPath)) {
        try {
          const v = JSON.parse(readFileSync(verdictPath, "utf8")) as {
            gate?: { pass?: boolean };
            verdict?: VerdictValue;
          };
          verdict = v.gate?.pass ? "verified" : (v.verdict ?? "failed");
        } catch {
          verdict = "failed";
        }
      }
      return { verdict, durationMs };
    },
    runHiddenChecks: async (c) => {
      const cwd = c.cwd ?? process.cwd();
      let failed = 0;
      for (const cmd of c.hiddenChecks ?? []) {
        const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: process.env });
        if ((r.status ?? 1) !== 0) failed += 1;
      }
      return failed;
    },
  };
}
