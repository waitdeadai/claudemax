import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import { formatPlanBudgetState } from "@claudemax/core";
import { detectPlan, describePlan } from "@claudemax/runtime";
import { computeParallelCap } from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Inspect billing mode, plan detection, parallel cap, recent credit consumption")
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .action((opts: { memory: string }) => {
      const info = detectPlan();
      console.log(kleur.bold("billing"));
      console.log(`  plan:        ${planColor(info.plan)}`);
      console.log(`  billing:     ${info.billing}`);
      console.log(`  credit:      ${info.monthlyCreditUsd != null ? `$${info.monthlyCreditUsd}/mo` : "(api — pay-per-token)"}`);
      console.log(`  source:      ${info.source}`);
      console.log(kleur.dim(`  ${describePlan(info)}`));

      let consumed = 0;
      try {
        const m = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
        consumed = m.creditConsumedThisPeriod();
        m.close();
      } catch (e) {
        console.log(kleur.dim(`  (no memory yet: ${(e as Error).message})`));
      }

      console.log(kleur.bold("\nbudget"));
      console.log(`  ${formatPlanBudgetState(info.plan, consumed)}`);

      const cap = computeParallelCap({
        plan: info.plan,
        remainingCreditUsd:
          info.monthlyCreditUsd != null ? Math.max(0, info.monthlyCreditUsd - consumed) : undefined,
        perPacketCostEstimateUsd: 0.4,
      });
      console.log(kleur.bold("\nparallel cap"));
      console.log(`  hardware:    ${cap.hardware}`);
      if (cap.creditAware != null) console.log(`  credit:      ${cap.creditAware}`);
      console.log(`  effective:   ${kleur.cyan(String(cap.effective))}`);
      console.log(kleur.dim(`  ${cap.reason}`));

      console.log(kleur.bold("\nauth surface"));
      console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? kleur.green("set") : kleur.gray("unset (subscription path active)")}`);
      console.log(`  CMAX_PLAN env:     ${process.env.CMAX_PLAN ?? kleur.gray("unset")}`);
    });
}

function planColor(plan: string): string {
  if (plan === "max20x") return kleur.magenta(plan);
  if (plan === "max5x") return kleur.blue(plan);
  if (plan === "pro") return kleur.cyan(plan);
  return kleur.gray(plan);
}
