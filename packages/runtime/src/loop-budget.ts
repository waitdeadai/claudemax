import { budgetTag, type BudgetTag, type BillingEra, type Plan } from "@claudemax/core";
import { detectPlan } from "./billing.js";
import { fleetLedgerSpendUsd } from "./loop-ledger.js";

// Fleet-level budget guard for standing-loops (docs/LOOP_MODE_PLAN.md §9). Boris's
// "dozens of loops + hundreds of agents" is exactly the shape of the documented
// $47K autonomous-loop runaway, so a per-run cap is not enough — the fleet's
// CUMULATIVE spend must gate continuation against the same 70/90/95 thresholds the
// rest of the harness uses. In the pre-split era budgetTag() returns "ok" by design
// (no monthly Agent SDK envelope exists yet); the per-tick caps still bound spend.

export interface FleetBudgetStatus {
  readonly plan: Plan;
  readonly era: BillingEra;
  readonly monthlyCreditUsd: number | null;
  readonly spentUsd: number;
  readonly tag: BudgetTag;
  readonly blocked: boolean; // tag === "blocked" → no new ACT may start
}

export function fleetBudgetStatus(cwd: string, extraUsd = 0): FleetBudgetStatus {
  const info = detectPlan();
  const spentUsd = fleetLedgerSpendUsd(cwd) + Math.max(0, extraUsd);
  const tag = budgetTag(info.plan, spentUsd, info.era);
  return {
    plan: info.plan,
    era: info.era,
    monthlyCreditUsd: info.monthlyCreditUsd,
    spentUsd,
    tag,
    blocked: tag === "blocked",
  };
}
