import { Command } from "commander";
import kleur from "kleur";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSpecMarkdown, type Spec } from "@claudemax/core";
import {
  runGoal,
  verify,
  detectPlan,
  deepResearch,
  decomposeIntoMultiSpec,
  runTddCycle,
  writeHandoff,
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
    .option("--tdd", "enforce write-failing-test-first cycle per sub-Spec where a test verifyHint exists", false)
    .option("--confidence <n>", "verifier confidence threshold for primary findings (0..1)", "0.8")
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
          tdd: boolean;
          confidence: string;
          memory: string;
        },
      ) => {
        const plan = detectPlan();
        const memory = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
        const started = Date.now();
        const cwd = process.cwd();
        const confidenceThreshold = Number(opts.confidence);

        console.log(
          kleur.dim(
            `plan=${plan.plan} billing=${plan.billing} credit=${plan.monthlyCreditUsd ?? "n/a"}/mo variant=${opts.variant} mode=${opts.mode} tdd=${opts.tdd ? "on" : "off"} conf>=${confidenceThreshold}`,
          ),
        );

        let brief;
        if (opts.research) {
          console.log(kleur.cyan("→ phase 1/5  /deepresearch"));
          brief = await deepResearch(goal, { cwd });
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
          writeHandoff({
            cwd,
            rootGoal: goal,
            phase: "deepresearch",
            summary: `${brief.sources.length} sources, ${brief.keyFindings.length} key findings on "${brief.topic}"`,
            nextInputs: [`research brief in memory`, ...brief.keyFindings.slice(0, 5)],
            artifacts: { sourceCount: String(brief.sources.length), topic: brief.topic },
          });
        }

        console.log(kleur.cyan("→ phase 2/5  multispec decompose"));
        const multispec = await decomposeIntoMultiSpec(goal, { cwd, researchBrief: brief });
        const specPath = resolve(cwd, opts.out);
        const rootSpec: Spec = {
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
        writeHandoff({
          cwd,
          rootGoal: goal,
          phase: "decompose",
          previousPhase: opts.research ? "deepresearch" : undefined,
          summary: `${multispec.subSpecs.length} sub-Specs, mode=${multispec.mode}: ${multispec.modeReason}`,
          nextInputs: multispec.subSpecs.map((s) => s.title),
          artifacts: { rootSpecPath: specPath, mode: multispec.mode },
        });

        console.log(
          kleur.cyan(
            `→ phase 3/5  parallel ${opts.tdd ? "TDD-cycle" : "/goal"} per sub-Spec`,
          ),
        );
        const subResults: Array<{ id: string; status: string; turns: number }> = [];
        await Promise.all(
          multispec.subSpecs.map(async (sub) => {
            const id = slugify(sub.title);
            if (opts.tdd && hasTestVerifyHint(sub)) {
              const t = await runTddCycle(sub, {
                cwd,
                maxTurns: Number(opts.maxTurns),
                permissionMode: opts.permission as
                  | "default"
                  | "acceptEdits"
                  | "plan"
                  | "bypassPermissions"
                  | "auto",
              });
              const status = t.phase === "test-passes" ? "finished" : t.phase === "stalled" ? "blocked" : "partial";
              subResults.push({ id, status, turns: t.turnsUsed });
              const colored = status === "finished" ? kleur.green : status === "blocked" ? kleur.yellow : kleur.yellow;
              console.log(colored(`  tdd:${t.phase}  ${id}  ${t.turnsUsed} turns`));
              return;
            }
            const r = await runGoal(sub, {
              cwd,
              maxTurns: Number(opts.maxTurns),
              permissionMode: opts.permission as
                | "default"
                | "acceptEdits"
                | "plan"
                | "bypassPermissions"
                | "auto",
            });
            subResults.push({ id, status: r.status, turns: r.turns });
            console.log(
              (r.status === "finished" ? kleur.green : kleur.yellow)(
                `  ${r.status === "finished" ? "ok    " : "block "} ${id}  ${r.turns} turns`,
              ),
            );
          }),
        );
        writeHandoff({
          cwd,
          rootGoal: goal,
          phase: "goal",
          previousPhase: "decompose",
          summary: `${subResults.filter((s) => s.status === "finished").length}/${subResults.length} sub-Specs finished; ${opts.tdd ? "TDD cycle" : "plain /goal"}`,
          nextInputs: subResults.map((r) => `${r.id}=${r.status}`),
          blockers: subResults.filter((r) => r.status !== "finished").map((r) => r.id),
          artifacts: Object.fromEntries(subResults.map((r) => [r.id, r.status])),
        });

        let rollupVerdict: "verified" | "partial" | "failed" | "skipped" = "skipped";
        if (opts.verify) {
          console.log(kleur.cyan("→ phase 4/5  per-sub-Spec /verify (parallel, blind Opus)"));
          const verifications = await Promise.all(
            multispec.subSpecs.map((s) => verify(s, { cwd, confidenceThreshold })),
          );
          for (const v of verifications) {
            const c = v.verdict === "verified" ? kleur.green : v.verdict === "partial" ? kleur.yellow : kleur.red;
            const suppressed = v.suppressedLowConfidence.length
              ? kleur.dim(` (${v.suppressedLowConfidence.length} suppressed <${v.confidenceThreshold})`)
              : "";
            console.log(c(`  ${v.verdict}  ${v.spec.title}${suppressed}`));
            for (const f of v.perCondition.filter((x) => !x.met).slice(0, 3)) {
              console.log(
                kleur.dim(
                  `    ↳ ${f.id} [${f.failureCategory ?? "?"}] next: ${f.actionableNext ?? "—"}`,
                ),
              );
            }
          }
          writeHandoff({
            cwd,
            rootGoal: goal,
            phase: "verify-per-spec",
            previousPhase: "goal",
            summary: verifications
              .map((v) => `${v.spec.title}=${v.verdict}`)
              .join("; "),
            nextInputs: ["rollup verifier should integrate per-sub-Spec verdicts"],
            blockers: verifications.filter((v) => v.verdict !== "verified").map((v) => v.spec.title),
          });

          console.log(kleur.cyan("→ phase 5/5  rollup /verify"));
          const rollup = await verify(rootSpec, { cwd, confidenceThreshold });
          rollupVerdict = rollup.verdict;
          const c = rollup.verdict === "verified" ? kleur.green : rollup.verdict === "partial" ? kleur.yellow : kleur.red;
          console.log(c(`  rollup: ${rollup.verdict}`));
          writeHandoff({
            cwd,
            rootGoal: goal,
            phase: "verify-rollup",
            previousPhase: "verify-per-spec",
            summary: `rollup verdict=${rollup.verdict}; ${rollup.perCondition.filter((f) => f.met).length}/${rollup.perCondition.length} conditions met`,
            nextInputs: rollup.perCondition.filter((f) => !f.met).map((f) => `${f.id}: ${f.actionableNext ?? "no actionable next"}`),
            blockers: rollup.perCondition.filter((f) => !f.met).map((f) => f.id),
          });
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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const TEST_RE = /\b(?:test|spec|vitest|jest|pytest|cargo test|go test|pnpm test|npm test|yarn test)\b/i;
function hasTestVerifyHint(spec: Spec): boolean {
  return spec.completionConditions.some((cc) => TEST_RE.test(cc.verifyHint));
}
