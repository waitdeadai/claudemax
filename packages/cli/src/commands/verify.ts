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
    .option("--confidence <n>", "confidence threshold for primary findings (0..1)", "0.8")
    .option("--max-turns <n>", "turn budget for the blind verifier (raise for large multi-condition specs)", "40")
    .action(async (specPath: string, opts: { confidence: string; maxTurns: string }) => {
      const md = readFileSync(resolve(process.cwd(), specPath), "utf8");
      const spec = parseSpecMarkdown(md);
      const confidenceThreshold = Number(opts.confidence);
      const maxTurns = Number(opts.maxTurns);
      console.log(kleur.cyan(`→ verifying ${spec.title} with blind Opus pass (threshold ${confidenceThreshold}, maxTurns ${maxTurns})...`));
      const report = await verify(spec, { confidenceThreshold, maxTurns });
      const color =
        report.verdict === "verified"
          ? kleur.green
          : report.verdict === "partial"
            ? kleur.yellow
            : kleur.red;
      console.log(color(`\n${report.verdict.toUpperCase()}`));
      for (const c of report.perCondition) {
        const sym = c.met ? kleur.green("✓") : kleur.red("✗");
        const conf = kleur.dim(`(conf ${c.confidence.toFixed(2)})`);
        const merged = c.consolidatedFrom?.length
          ? kleur.dim(` [+${c.consolidatedFrom.length} merged]`)
          : "";
        console.log(`  ${sym} ${kleur.cyan(c.id)} ${conf}${merged} — ${c.evidence}`);
        if (!c.met) {
          console.log(
            kleur.dim(
              `      category: ${c.failureCategory ?? "?"}  next: ${c.actionableNext ?? "—"}`,
            ),
          );
        }
      }
      if (report.suppressedLowConfidence.length) {
        console.log(
          kleur.dim(
            `\n${report.suppressedLowConfidence.length} suppressed finding(s) below threshold ${report.confidenceThreshold}:`,
          ),
        );
        for (const f of report.suppressedLowConfidence) {
          console.log(
            kleur.dim(`  · ${f.id} (conf ${f.confidence.toFixed(2)}) ${f.met ? "would-pass" : "would-fail"} — ${f.evidence}`),
          );
        }
      }
      if (report.notes) console.log(kleur.dim(`\nnotes: ${report.notes}`));
      process.exit(report.verdict === "verified" ? 0 : 1);
    });
}
