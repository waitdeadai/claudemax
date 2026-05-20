import { Command } from "commander";
import kleur from "kleur";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSpecMarkdown } from "@claudemax/core";
import {
  runGoal,
  verify,
  writeSpec,
  detectPlan,
  deepResearch,
  decomposeIntoMultiSpec,
} from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

type Variant = "opussonnet" | "opusolo";
type Mode = "auto" | "solo" | "teams";

export function runCommand(): Command {
  return new Command("run")
    .description("Full multispec pipeline: deepresearch → multispec → /goal × N → verify. Default = /opussonnet semantics.")
    .argument("<goal>", "the goal in natural language, in quotes")
    .option("--out <path>", "where to write the root SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "goal loop turn budget per sub-Spec", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions | auto",
      "acceptEdits",
    )
    .option("--variant <variant>", "opussonnet | opusolo", "opussonnet")
    .option("--mode <mode>", "auto | solo | teams (parallelism mode)", "auto")
    .option("--no-research", "skip /deepresearch (smaller / simpler goals)")
    .option("--no-verify", "skip independent verification step")
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .action(
      async (
        goal: string,
        opts: {
          out: string;
          maxTurns: string;
          permission: string;
          variant: Variant;
          mode: Mode;
          research: boolean;
          verify: boolean;
          memory: string;
        },
      ) => {
        const plan = detectPlan();
        const memory = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
        const started = Date.now();

        console.log(
          kleur.dim(
            `plan=${plan.plan} billing=${plan.billing} credit=${plan.monthlyCreditUsd ?? "n/a"}/mo variant=${opts.variant} mode=${opts.mode}`,
          ),
        );

        let brief;
        if (opts.research) {
          console.log(kleur.cyan("→ phase 1/5  /deepresearch"));
          brief = await deepResearch(goal, { cwd: process.cwd() });
          for (const s of brief.sources.slice(0, 5)) {
            memory.recordResearchSource({
              topic: brief.topic,
              url: s.url,
              title: s.title,
              publishedAt: s.publishedAt,
              relevance: s.relevance,
              excerpt: s.excerpt,
            });
          }
          console.log(kleur.green(`  ✓ ${brief.sources.length} sources, ${brief.keyFindings.length} key findings`));
        }

        console.log(kleur.cyan("→ phase 2/5  multispec decompose"));
        const multispec = await decomposeIntoMultiSpec(goal, {
          cwd: process.cwd(),
          researchBrief: brief,
        });
        const specPath = resolve(process.cwd(), opts.out);
        const rootSpec = {
          title: multispec.rootGoal,
          goal: multispec.rootGoal,
          nonGoals: [],
          constraints: [],
          completionConditions: multispec.rollupCompletionConditions,
          assumptions: [],
          evidenceRequired: [],
          createdAt: multispec.createdAt,
        };
        writeFileSync(specPath, renderSpecMarkdown(rootSpec), "utf8");
        console.log(
          kleur.green(
            `  ✓ ${multispec.subSpecs.length} sub-Specs, mode=${multispec.mode} (${multispec.modeReason})`,
          ),
        );

        console.log(kleur.cyan("→ phase 3/5  parallel /goal per sub-Spec"));
        const subResults: Array<{ id: string; status: string; turns: number }> = [];
        await Promise.all(
          multispec.subSpecs.map(async (sub) => {
            const r = await runGoal(sub, {
              cwd: process.cwd(),
              maxTurns: Number(opts.maxTurns),
              permissionMode: opts.permission as "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto",
            });
            const id = sub.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            subResults.push({ id, status: r.status, turns: r.turns });
            console.log(
              (r.status === "finished" ? kleur.green : kleur.yellow)(
                `  ${r.status === "finished" ? "ok    " : "block "} ${id}  ${r.turns} turns`,
              ),
            );
          }),
        );

        let rollupVerdict: "verified" | "partial" | "failed" | "skipped" = "skipped";
        if (opts.verify) {
          console.log(kleur.cyan("→ phase 4/5  per-sub-Spec /verify (parallel, blind Opus)"));
          const verifications = await Promise.all(multispec.subSpecs.map((s) => verify(s, { cwd: process.cwd() })));
          for (const v of verifications) {
            const c = v.verdict === "verified" ? kleur.green : v.verdict === "partial" ? kleur.yellow : kleur.red;
            console.log(c(`  ${v.verdict}  ${v.spec.title}`));
          }

          console.log(kleur.cyan("→ phase 5/5  rollup /verify"));
          const rollup = await verify(rootSpec, { cwd: process.cwd() });
          rollupVerdict = rollup.verdict;
          const c = rollup.verdict === "verified" ? kleur.green : rollup.verdict === "partial" ? kleur.yellow : kleur.red;
          console.log(c(`  rollup: ${rollup.verdict}`));
        }

        const finalStatus =
          rollupVerdict === "verified"
            ? "finished"
            : rollupVerdict === "partial"
              ? "partial"
              : rollupVerdict === "failed"
                ? "failed"
                : subResults.every((r) => r.status === "finished")
                  ? "finished"
                  : "partial";

        memory.recordRun({
          specTitle: multispec.rootGoal.slice(0, 80),
          goal: multispec.rootGoal,
          status: finalStatus,
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          durationMs: Date.now() - started,
          plan: plan.plan,
          mode: multispec.mode,
          evidence: { rollupVerdict, subResults },
        });
        memory.close();

        console.log(kleur.bold(`\n${finalStatus === "finished" ? "✓" : "✗"} ${finalStatus}`));
        process.exit(finalStatus === "finished" ? 0 : 1);
      },
    );
}
