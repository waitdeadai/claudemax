import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpecMarkdown } from "@claudemax/core";
import { runGoal } from "@claudemax/runtime";

export function goalCommand(): Command {
  return new Command("goal")
    .description("Autonomously pursue a SPEC until completion conditions are met (Opus loop)")
    .argument("[spec]", "path to SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "abort after N turns", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions",
      "acceptEdits",
    )
    .action(
      async (
        specPath: string,
        opts: { maxTurns: string; permission: string },
      ) => {
        const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
        const spec = parseSpecMarkdown(md);
        console.log(kleur.cyan(`→ goal: ${spec.title}`));
        console.log(kleur.dim(`  ${spec.completionConditions.length} completion conditions`));
        const r = await runGoal(spec, {
          maxTurns: Number(opts.maxTurns),
          permissionMode: opts.permission as "default" | "acceptEdits" | "plan" | "bypassPermissions",
          onTurn: (turn) => {
            if (turn % 5 === 0) process.stderr.write(kleur.dim(`  ${turn} turns…\n`));
          },
        });
        const statusColor =
          r.status === "finished" ? kleur.green : r.status === "blocked" ? kleur.yellow : kleur.red;
        console.log(statusColor(`\n${r.status.toUpperCase()}`));
        console.log(kleur.dim(`turns=${r.turns} tokens=${r.tokensIn}+${r.tokensOut}`));
        if (Object.keys(r.evidence).length) {
          console.log(kleur.bold("evidence:"));
          for (const [k, v] of Object.entries(r.evidence)) {
            console.log(`  ${kleur.cyan(k)}: ${v}`);
          }
        }
        console.log(kleur.bold("\nsummary:"));
        console.log(r.summary);
        process.exit(r.status === "finished" ? 0 : 1);
      },
    );
}
