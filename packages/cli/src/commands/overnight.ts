import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpecMarkdown } from "@claudemax/core";
import { runOvernight } from "@claudemax/runtime";

export function overnightCommand(): Command {
  return new Command("overnight")
    .description("Long-running mode with file checkpointing + session resumption")
    .argument("[spec]", "path to SPEC.md", "SPEC.md")
    .requiredOption("--budget-credits <usd>", "hard budget cap in USD of Agent SDK credit")
    .option("--max-turns <n>", "per-iteration turn cap", "200")
    .action(async (specPath: string, opts: { budgetCredits: string; maxTurns: string }) => {
      const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
      const spec = parseSpecMarkdown(md);
      console.log(kleur.cyan(`→ overnight: ${spec.title} (budget=$${opts.budgetCredits})`));
      const r = await runOvernight(spec, {
        cwd: process.cwd(),
        budgetCreditsUsd: Number(opts.budgetCredits),
        maxTurns: Number(opts.maxTurns),
        onCheckpoint: (turn, sessionId) =>
          console.log(kleur.dim(`  checkpoint turn=${turn} session=${sessionId ?? "n/a"}`)),
      });
      const sc =
        r.finalStatus === "finished"
          ? kleur.green
          : r.finalStatus === "blocked" || r.finalStatus === "budget-exceeded"
            ? kleur.yellow
            : kleur.red;
      console.log(sc(`\n${r.finalStatus}`));
      console.log(kleur.dim(`credit consumed: $${r.totalCreditUsd.toFixed(2)}; checkpoints: ${r.checkpoints.length}`));
      process.exit(r.finalStatus === "finished" ? 0 : 1);
    });
}
