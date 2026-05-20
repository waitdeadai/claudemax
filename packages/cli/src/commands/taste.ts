import { Command } from "commander";
import kleur from "kleur";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { autoBootstrapTaste } from "@claudemax/runtime";

export function tasteCommand(): Command {
  const cmd = new Command("taste").description("Project taste kernel (taste.md + taste.vision)");

  cmd
    .command("init")
    .description("Auto-bootstrap taste.md + taste.vision via /deepresearch (NO 10-question wizard)")
    .option("--regenerate", "ignore existing files; re-derive from scratch", false)
    .action(async (opts: { regenerate: boolean }) => {
      void opts;
      console.log(kleur.cyan("→ reading repo signals + /deepresearch on SOTA at current time..."));
      const result = await autoBootstrapTaste({
        cwd: process.cwd(),
        singleQuestionFallback: async (q) => {
          const rl = createInterface({ input: stdin, output: stdout });
          const ans = await rl.question(kleur.yellow(`? ${q} `));
          rl.close();
          return ans.trim();
        },
      });
      if (result.askedFallbackQuestion) {
        console.log(kleur.dim("  (fallback question asked because repo had no signal)"));
      }
      console.log(kleur.green(`✓ ${result.tastePath}`));
      console.log(kleur.green(`✓ ${result.visionPath}`));
      console.log(kleur.dim("\nReview the files and edit if needed. Re-run with --regenerate to start over."));
    });

  return cmd;
}
