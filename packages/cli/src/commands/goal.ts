import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpecMarkdown } from "@claudemax/core";
import { runGoal, runGoalNative } from "@claudemax/runtime";

export function goalCommand(): Command {
  return new Command("goal")
    .description("Autonomously pursue a SPEC until completion conditions are met (Opus loop)")
    .argument("[spec]", "path to SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "abort after N turns", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions",
      "bypassPermissions",
    )
    .option(
      "--native-goal",
      "wrap Claude Code's native /goal (v2.1.139+) instead of the custom driver",
      false,
    )
    .action(
      async (
        specPath: string,
        opts: { maxTurns: string; permission: string; nativeGoal: boolean },
      ) => {
        const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
        const spec = parseSpecMarkdown(md);
        console.log(kleur.cyan(`→ goal: ${spec.title}${opts.nativeGoal ? " (native /goal wrapper)" : ""}`));
        console.log(kleur.dim(`  ${spec.completionConditions.length} completion conditions`));
        const useNative = opts.nativeGoal || process.env["CMAX_USE_NATIVE_GOAL"] === "1";
        // Guard against NaN from a bad/empty --max-turns (NaN silently disables the
        // turn cap downstream); log the raw value so the cap is diagnosable.
        const maxTurnsNum = Number(opts.maxTurns) || 200;
        process.stderr.write(
          `  [goal-cli] --max-turns raw=${JSON.stringify(opts.maxTurns)} → cap ${maxTurnsNum}\n`,
        );
        const r = useNative
          ? await runGoalNative(spec, { maxTurns: maxTurnsNum })
          : await runGoal(spec, {
              maxTurns: maxTurnsNum,
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
