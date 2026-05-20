import { Command } from "commander";
import kleur from "kleur";
import { classifyHeuristic, route, type ModelTier, type TaskClass } from "@claudemax/core";

export function routeCommand(): Command {
  return new Command("route")
    .description("Show the router decision for a task summary")
    .argument("<summary>", "one-line task description")
    .option("--complexity <n>", "1-10", "5")
    .option("--novelty <n>", "1-10", "3")
    .option("--domain <name>", "auth, payments, ui, ...")
    .option("--tier <tier>", "force opus|sonnet|haiku")
    .option("--cost-ceiling <usd>", "demote to cheaper tier if estimated cost exceeds")
    .option("--cheap", "force cheap mode (demote opus → sonnet outside verify/spec)")
    .action(
      (
        summary: string,
        opts: {
          complexity: string;
          novelty: string;
          domain?: string;
          tier?: string;
          costCeiling?: string;
          cheap?: boolean;
        },
      ) => {
        const cls: TaskClass = classifyHeuristic(summary);
        const decision = route(
          {
            class: cls,
            complexity: Number(opts.complexity),
            novelty: Number(opts.novelty),
            domain: opts.domain,
            summary,
          },
          {
            explicitTier: opts.tier as ModelTier | undefined,
            costCeilingUsd: opts.costCeiling ? Number(opts.costCeiling) : undefined,
            forceCheap: opts.cheap,
          },
        );

        console.log(kleur.bold("router decision"));
        console.log(`  class:     ${kleur.cyan(cls)}`);
        console.log(`  tier:      ${tierColor(decision.tier)}`);
        console.log(`  model:     ${kleur.dim(decision.model)}`);
        console.log(`  tools:     ${decision.tools.join(", ")}`);
        console.log(`  maxTurns:  ${decision.maxTurns}`);
        console.log(`  est cost:  $${decision.estimatedCostUsd.toFixed(4)}`);
        console.log(`  escalated: ${decision.escalated}`);
        console.log(`  reason:    ${kleur.dim(decision.reasoning)}`);
      },
    );
}

function tierColor(t: ModelTier): string {
  if (t === "opus") return kleur.magenta(t);
  if (t === "sonnet") return kleur.blue(t);
  return kleur.gray(t);
}
