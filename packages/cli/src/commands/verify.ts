import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpecMarkdown } from "@claudemax/core";
import { verify } from "@claudemax/runtime";

export function verifyCommand(): Command {
  return new Command("verify")
    .description("Independent Opus supervisor verifies SPEC was met")
    .argument("[spec]", "path to SPEC.md", "SPEC.md")
    .action(async (specPath: string) => {
      const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
      const spec = parseSpecMarkdown(md);
      console.log(kleur.cyan(`→ verifying ${spec.title} with blind Opus pass...`));
      const report = await verify(spec);
      const color =
        report.verdict === "verified"
          ? kleur.green
          : report.verdict === "partial"
            ? kleur.yellow
            : kleur.red;
      console.log(color(`\n${report.verdict.toUpperCase()}`));
      for (const c of report.perCondition) {
        const sym = c.met ? kleur.green("✓") : kleur.red("✗");
        console.log(`  ${sym} ${kleur.cyan(c.id)} — ${c.evidence}`);
      }
      if (report.notes) console.log(kleur.dim(`\nnotes: ${report.notes}`));
      process.exit(report.verdict === "verified" ? 0 : 1);
    });
}
