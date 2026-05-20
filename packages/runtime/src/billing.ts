import { execSync } from "node:child_process";
import { MONTHLY_CREDIT_USD, type Plan, type PlanInfo } from "@claudemax/core";

export function detectPlan(): PlanInfo {
  const envPlan = process.env["CMAX_PLAN"] as Plan | undefined;
  if (envPlan && envPlan in MONTHLY_CREDIT_USD) {
    return {
      plan: envPlan,
      billing: envPlan === "api" ? "api" : "subscription",
      monthlyCreditUsd: MONTHLY_CREDIT_USD[envPlan],
      source: "env",
    };
  }

  if (process.env["ANTHROPIC_API_KEY"]) {
    return {
      plan: "api",
      billing: "api",
      monthlyCreditUsd: null,
      source: "auto-detect",
    };
  }

  if (process.env["CMAX_SKIP_CLI_PROBE"] !== "1") {
    const cliPlan = probeClaudeCliPlan();
    if (cliPlan) {
      return {
        plan: cliPlan,
        billing: "subscription",
        monthlyCreditUsd: MONTHLY_CREDIT_USD[cliPlan],
        source: "auto-detect",
      };
    }
  }

  return {
    plan: "max5x",
    billing: "subscription",
    monthlyCreditUsd: MONTHLY_CREDIT_USD["max5x"],
    source: "default",
  };
}

function probeClaudeCliPlan(): Plan | null {
  try {
    const probe = execSync("claude config get plan 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const txt = (probe || "").toLowerCase();
    if (txt.includes("max20x") || txt.includes("max-20x") || txt.includes("max 20x")) return "max20x";
    if (txt.includes("max5x") || txt.includes("max-5x") || txt.includes("max 5x")) return "max5x";
    if (txt.includes("pro")) return "pro";
    return null;
  } catch {
    return null;
  }
}

export function describePlan(info: PlanInfo): string {
  if (info.billing === "api") {
    return `api (pay-per-token via ANTHROPIC_API_KEY) — source: ${info.source}`;
  }
  return `subscription ${info.plan} — $${info.monthlyCreditUsd} Agent SDK credit/mo — source: ${info.source}`;
}
