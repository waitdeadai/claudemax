import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Spec } from "@claudemax/core";
import { runGoal, type GoalRunResult } from "./goal.js";

export interface OvernightOptions {
  readonly cwd: string;
  readonly budgetCreditsUsd: number;
  readonly maxTurns?: number;
  readonly stateDir?: string;
  readonly onCheckpoint?: (turn: number, sessionId: string | undefined) => void;
}

export interface OvernightCheckpoint {
  readonly turn: number;
  readonly sessionId?: string;
  readonly ts: string;
  readonly creditConsumedUsd: number;
  readonly status: "running" | "finished" | "blocked" | "max-turns" | "budget-exceeded";
}

export interface OvernightRunResult {
  readonly finalStatus: OvernightCheckpoint["status"];
  readonly checkpoints: readonly OvernightCheckpoint[];
  readonly lastGoalResult?: GoalRunResult;
  readonly totalCreditUsd: number;
}

export async function runOvernight(
  spec: Spec,
  opts: OvernightOptions,
): Promise<OvernightRunResult> {
  const stateDir = opts.stateDir ?? join(opts.cwd, ".claudemax", "state", "overnight");
  mkdirSync(stateDir, { recursive: true });
  const checkpointPath = join(stateDir, `${slug(spec.title)}.checkpoint.json`);

  let totalCreditUsd = 0;
  let resumeId: string | undefined;
  const checkpoints: OvernightCheckpoint[] = [];

  if (existsSync(checkpointPath)) {
    try {
      const prev = JSON.parse(readFileSync(checkpointPath, "utf8")) as OvernightCheckpoint;
      resumeId = prev.sessionId;
      totalCreditUsd = prev.creditConsumedUsd;
      checkpoints.push(prev);
    } catch {
      // start fresh if checkpoint is corrupt
    }
  }

  let lastResult: GoalRunResult | undefined;

  while (true) {
    if (totalCreditUsd >= opts.budgetCreditsUsd) {
      return { finalStatus: "budget-exceeded", checkpoints, lastGoalResult: lastResult, totalCreditUsd };
    }

    const remainingBudget = opts.budgetCreditsUsd - totalCreditUsd;
    lastResult = await runGoal(spec, {
      cwd: opts.cwd,
      maxTurns: opts.maxTurns,
      maxBudgetUsd: remainingBudget,
      resume: resumeId,
    });

    const usedThisRun = estimateUsd(lastResult.tokensIn, lastResult.tokensOut);
    totalCreditUsd += usedThisRun;

    const ck: OvernightCheckpoint = {
      turn: lastResult.turns,
      sessionId: lastResult.sessionId,
      ts: new Date().toISOString(),
      creditConsumedUsd: totalCreditUsd,
      status:
        lastResult.status === "finished"
          ? "finished"
          : lastResult.status === "blocked"
            ? "blocked"
            : "max-turns",
    };
    checkpoints.push(ck);
    writeFileSync(checkpointPath, JSON.stringify(ck, null, 2), "utf8");
    opts.onCheckpoint?.(ck.turn, ck.sessionId);

    if (ck.status !== "max-turns") {
      return { finalStatus: ck.status, checkpoints, lastGoalResult: lastResult, totalCreditUsd };
    }
    resumeId = lastResult.sessionId;
  }
}

function estimateUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * 15 + (tokensOut / 1_000_000) * 75;
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
