import { Command } from "commander";
import kleur from "kleur";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSpecMarkdown } from "@claudemax/core";
import { writeSpec } from "@claudemax/runtime";

export function specCommand(): Command {
  return new Command("spec")
    .description("Generate SPEC.md from a goal (Opus)")
    .argument("<goal>", "the goal in natural language, in quotes")
    .option("-o, --out <path>", "output path", "SPEC.md")
    .option("--context <path>", "path to a file with repo context")
    .action(async (goal: string, opts: { out: string; context?: string }) => {
      const context = opts.context ? readFileSync(opts.context, "utf8") : undefined;
      console.log(kleur.cyan("→ writing spec with Opus..."));
      const spec = await writeSpec(goal, { context });
      const md = renderSpecMarkdown(spec);
      const outPath = resolve(process.cwd(), opts.out);
      writeFileSync(outPath, md, "utf8");
      console.log(kleur.green(`✓ ${outPath}`));
      console.log(kleur.dim(`  ${spec.completionConditions.length} completion conditions`));
    });
}
