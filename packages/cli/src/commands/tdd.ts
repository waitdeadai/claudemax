import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpecMarkdown } from "@claudemax/core";
import { runTddCycle } from "@claudemax/runtime";

export function tddCommand(): Command {
  return new Command("tdd")
    .description("Run the strict test-first cycle: write failing test → implement → verify test passes")
    .argument("[spec]", "path to SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "turn budget for the cycle", "80")
    .option("--test-command <cmd>", "override the test command (default inferred from verifyHints)")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions | auto",
      "acceptEdits",
    )
    .action(
      async (
        specPath: string,
        opts: { maxTurns: string; testCommand?: string; permission: string },
      ) => {
        const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
        const spec = parseSpecMarkdown(md);
        console.log(kleur.cyan(`→ TDD cycle for ${spec.title}`));
        const r = await runTddCycle(spec, {
          maxTurns: Number(opts.maxTurns),
          testCommand: opts.testCommand,
          permissionMode: opts.permission as
            | "default"
            | "acceptEdits"
            | "plan"
            | "bypassPermissions"
            | "auto",
        });
        const color =
          r.phase === "test-passes"
            ? kleur.green
            : r.phase === "stalled"
              ? kleur.red
              : kleur.yellow;
        console.log(color(`\n${r.phase.toUpperCase()}  (${r.turnsUsed} turns)`));
        if (r.failingTestPath) console.log(kleur.dim(`failing test: ${r.failingTestPath}`));
        for (const e of r.evidence) console.log(`  · ${e}`);
        if (r.notes) console.log(kleur.dim(`\nnotes: ${r.notes}`));
        process.exit(r.phase === "test-passes" ? 0 : 1);
      },
    );
}
