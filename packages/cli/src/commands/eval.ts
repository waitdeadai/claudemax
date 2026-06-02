import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultEvalDeps,
  renderAblationReport,
  runAblations,
  runEval,
  STANDARD_ABLATIONS,
  type EvalCase,
} from "@claudemax/runtime";

export function evalCommand(): Command {
  return new Command("eval")
    .description(
      "Run a private task set through the pipeline and report production-hotfix-rate + verifier false-positive rate (§6). --ablations compares full vs no-verify/no-ssc/no-adversarial.",
    )
    .argument("[tasks]", "path to the eval task set JSON (array of EvalCase)", "eval/tasks.json")
    .option("--ablations", "run the standard ablation matrix and print the comparison", false)
    .option("--ssc", "enable SSC for the single (non-ablation) run", false)
    .option("--adversarial", "enable adversarial verify for the single run", false)
    .action(
      async (tasksPath: string, opts: { ablations: boolean; ssc: boolean; adversarial: boolean }) => {
        let cases: EvalCase[];
        try {
          cases = JSON.parse(readFileSync(resolve(process.cwd(), tasksPath), "utf8")) as EvalCase[];
        } catch (err) {
          console.error(kleur.red(`could not read eval task set at ${tasksPath}: ${err instanceof Error ? err.message : String(err)}`));
          console.error(kleur.dim("  start from eval/tasks.example.json (copy to eval/tasks.json, fill in cwd + hiddenChecks)."));
          process.exit(2);
        }
        if (!Array.isArray(cases) || cases.length === 0) {
          console.error(kleur.red(`no eval cases found in ${tasksPath} (expected a non-empty JSON array).`));
          process.exit(2);
        }
        console.log(kleur.cyan(`→ cmax eval: ${cases.length} case(s) from ${tasksPath}`));
        console.log(
          kleur.dim(
            "  production-hotfix-rate = of tasks marked 'verified', the fraction a hidden post-done check then found broken. Lower is better.",
          ),
        );
        const deps = defaultEvalDeps();

        if (opts.ablations) {
          const results = await runAblations(cases, deps, STANDARD_ABLATIONS);
          console.log("\n" + renderAblationReport(results));
          const full = results.find((r) => r.ablation === "full");
          process.exit(full && full.metrics.productionHotfixRate === 0 ? 0 : 1);
        }

        const r = await runEval(cases, deps, {
          label: "run",
          verify: true,
          ssc: opts.ssc,
          adversarial: opts.adversarial,
        });
        console.log("\n" + renderAblationReport([r]));
        for (const o of r.outcomes) {
          const ok = o.pipelineVerdict === "verified" && o.hotfixDefects === 0;
          console.log(
            (ok ? kleur.green : kleur.red)(
              `  ${o.caseId}: ${o.pipelineVerdict}${o.hotfixDefects ? ` (${o.hotfixDefects} post-done defect[s])` : ""}`,
            ),
          );
        }
        process.exit(r.metrics.productionHotfixRate === 0 ? 0 : 1);
      },
    );
}
