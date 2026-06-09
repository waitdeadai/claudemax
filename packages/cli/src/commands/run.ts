import { Command } from "commander";
import kleur from "kleur";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  execModelForVariant,
  renderSpecMarkdown,
  resolveBillingEra,
  type ModelId,
  type Spec,
  type VerificationReport,
} from "@claudemax/core";
import {
  runGoal,
  verify,
  markRunActive,
  hardenSpec,
  detectEasyPass,
  detectPlan,
  deepResearch,
  decomposeIntoMultiSpec,
  runTddCycle,
  runSimplifyPass,
  runAgentTeams,
  writeHandoff,
  isSaturationSignal,
  parseResetTime,
  type EffortLevel,
} from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

type Variant = "opussonnet" | "opusolo";
type Mode = "auto" | "solo" | "teams";
type Phase = "deepresearch" | "decompose" | "goal" | "verify";

export function runCommand(): Command {
  return new Command("run")
    .description("Full multispec pipeline: deepresearch → multispec → /goal × N → verify. Default = /opussonnet semantics.")
    .argument("<goal>", "the goal in natural language, in quotes")
    .option("--out <path>", "where to write the root SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "goal loop turn budget per sub-Spec", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions | auto",
      "bypassPermissions",
    )
    .option("--variant <variant>", "opussonnet | opusolo", "opussonnet")
    .option(
      "--effort <level>",
      "high | xhigh | max — Opus effort for execution lanes (default xhigh, the SOTA-2026 sweet spot for agentic coding; max only for frontier one-offs — it ~2× the token/pool burn for ~3% and can overthink structured output)",
      "xhigh",
    )
    .option("--mode <mode>", "auto | solo | teams (parallelism mode)", "auto")
    .option("--no-research", "skip /deepresearch (smaller / simpler goals)")
    .option("--no-verify", "skip independent verification step")
    .option("--mvp", "opt out of the production-ready bar (PRC): sub-Specs keep only their explicit completion conditions — MVP is the exception, not the default", false)
    .option("--ssc", "Specification Self-Correction: harden each sub-Spec (tighten gameable verifyHints, add edge/failure coverage) before execution, and re-examine a verify that passed too easily", false)
    .option("--tdd", "enforce write-failing-test-first cycle per sub-Spec where a test verifyHint exists", false)
    .option("--simplify", "behavior-gated simplify pass between build and verify (≤2 rounds; auto-on for --variant opusolo, set CMAX_NO_SIMPLIFY=1 to disable that). Reverts any round that touches a test or reddens the suite", false)
    .option("--confidence <n>", "verifier confidence threshold for primary findings (0..1)", "0.8")
    .option("--adversarial", "adversarial verify: stress-test the blind verifier with fabricated-claim mutants + isomorphic restatement, and downgrade any condition it can be fooled about", false)
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .action(
      async (
        goal: string,
        opts: {
          out: string;
          maxTurns: string;
          permission: string;
          variant: Variant;
          effort: string;
          mode: Mode;
          research: boolean;
          verify: boolean;
          mvp: boolean;
          ssc: boolean;
          tdd: boolean;
          simplify: boolean;
          confidence: string;
          adversarial: boolean;
          memory: string;
        },
      ) => {
        const plan = detectPlan();
        const memory = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
        const started = Date.now();
        const cwd = process.cwd();
        const confidenceThreshold = Number(opts.confidence);

        // Variant → executor model, era-aware. opusolo runs Opus everywhere. In the
        // PRE-SPLIT era (until 2026-06-15) opussonnet also executes sub-Specs on Opus
        // 4.8 — the shared 5h pool makes Opus cost the same as Sonnet, so we take the
        // higher ceiling (4× fewer unflagged flaws). Post-split it reverts to Sonnet.
        // plan/decompose + verify always stay Opus regardless of variant/era (rule #4).
        const era = resolveBillingEra();
        const execModel: ModelId = execModelForVariant(opts.variant, era);
        const effort = normalizeEffort(opts.effort);

        console.log(
          kleur.dim(
            `plan=${plan.plan} billing=${plan.billing} era=${era} credit=${plan.monthlyCreditUsd ?? "n/a"}/mo variant=${opts.variant} exec=${execModel} effort=${effort} mode=${opts.mode} tdd=${opts.tdd ? "on" : "off"} simplify=${opts.simplify || opts.variant === "opusolo" ? "on" : "off"} conf>=${confidenceThreshold}`,
          ),
        );

        // Track the phase so a mid-run interrupt (Anthropic session/rate limit)
        // can tell the user where it stopped and how to recover without a rebuild.
        let phase: Phase = "decompose";
        try {
          let brief;
          if (opts.research) {
            phase = "deepresearch";
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
              nextInputs: [`research brief in memory`, ...brief.keyFindings.slice(0, 5).map((f) => f.finding)],
              artifacts: { sourceCount: String(brief.sources.length), topic: brief.topic },
            });
          }

          phase = "decompose";
          console.log(kleur.cyan("→ phase 2/5  multispec decompose"));
          let multispec = await decomposeIntoMultiSpec(goal, { cwd, researchBrief: brief, mvp: opts.mvp });
          if (opts.ssc) {
            console.log(kleur.cyan("→ SSC: hardening sub-Specs before execution (tighten gameable verifyHints, add edge/failure coverage)"));
            const hardenedSubs = await Promise.all(
              multispec.subSpecs.map(async (s) => {
                const { hardened, changes } = await hardenSpec(s, { cwd, effort });
                if (changes.length) console.log(kleur.dim(`  ${slugify(s.title)}: ${changes.length} hardening edit(s)`));
                return hardened;
              }),
            );
            multispec = { ...multispec, subSpecs: hardenedSubs };
          }
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

          phase = "goal";
          const permissionMode = opts.permission as
            | "default"
            | "acceptEdits"
            | "plan"
            | "bypassPermissions"
            | "auto";
          // Mode B (Agent Teams) when the spec is large enough (or forced); else Mode A (in-process).
          const effectiveMode = opts.mode === "auto" ? multispec.mode : opts.mode;
          const subResults: Array<{ id: string; status: string; turns: number }> = [];

          if (effectiveMode === "teams") {
            console.log(
              kleur.cyan(
                `→ phase 3/5  Agent Teams (Mode B) — ${multispec.subSpecs.length} teammates, exec=${execModel}`,
              ),
            );
            const teams = await runAgentTeams(multispec, {
              cwd,
              model: execModel,
              onTeammateEnd: (id, status) =>
                console.log(
                  (status === "finished" ? kleur.green : kleur.yellow)(`  team:${status}  ${id}`),
                ),
            });
            for (const [id, status] of Object.entries(teams.perSubSpec)) {
              subResults.push({ id, status, turns: 0 });
            }
          } else {
            console.log(
              kleur.cyan(
                `→ phase 3/5  parallel ${opts.tdd ? "TDD-cycle" : "/goal"} per sub-Spec (solo, exec=${execModel})`,
              ),
            );
            await Promise.all(
              multispec.subSpecs.map(async (sub) => {
                const id = slugify(sub.title);
                if (opts.tdd && hasTestVerifyHint(sub)) {
                  const t = await runTddCycle(sub, {
                    cwd,
                    model: execModel,
                    effort,
                    maxTurns: Number(opts.maxTurns),
                    permissionMode,
                  });
                  const status = t.phase === "test-passes" ? "finished" : t.phase === "stalled" ? "blocked" : "partial";
                  subResults.push({ id, status, turns: t.turnsUsed });
                  const colored = status === "finished" ? kleur.green : status === "blocked" ? kleur.yellow : kleur.yellow;
                  console.log(colored(`  tdd:${t.phase}  ${id}  ${t.turnsUsed} turns`));
                  return;
                }
                const r = await runGoal(sub, {
                  cwd,
                  model: execModel,
                  effort,
                  maxTurns: Number(opts.maxTurns),
                  permissionMode,
                });
                subResults.push({ id, status: r.status, turns: r.turns });
                console.log(
                  (r.status === "finished" ? kleur.green : kleur.yellow)(
                    `  ${r.status === "finished" ? "ok    " : "block "} ${id}  ${r.turns} turns`,
                  ),
                );
              }),
            );
          }
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

          // Behavior-gated simplify pass (post-build, pre-verify). Opt-in; auto-on
          // for opusolo. Bounded to ≤2 rounds (the SOTA front-loaded-gains window);
          // any round that touches a test or reddens the suite is reverted. Solo
          // mode only — Mode B teammates work in isolated worktrees, so the lead's
          // cwd diff would not reflect their changes.
          const doSimplify =
            opts.simplify ||
            (opts.variant === "opusolo" && process.env["CMAX_NO_SIMPLIFY"] !== "1");
          if (doSimplify && effectiveMode === "teams") {
            console.log(kleur.dim("→ simplify pass skipped (Mode B / Agent Teams use isolated worktrees)"));
          } else if (doSimplify) {
            console.log(kleur.cyan("→ simplify pass (behavior-gated, ≤2 rounds, post-build/pre-verify)"));
            const simp = await runSimplifyPass({
              cwd,
              model: execModel,
              effort,
              permissionMode,
            });
            const col =
              simp.status === "applied"
                ? kleur.green
                : simp.status === "reverted"
                  ? kleur.yellow
                  : kleur.dim;
            console.log(col(`  simplify: ${simp.status} — ${simp.reason}`));
            for (const e of simp.evidence) console.log(kleur.dim(`    ${e}`));
            writeHandoff({
              cwd,
              rootGoal: goal,
              phase: "simplify",
              previousPhase: "goal",
              summary: `simplify ${simp.status} (${simp.rounds} round(s), oracle=${simp.oracle}): ${simp.reason}`,
              nextInputs: simp.evidence,
              artifacts: { status: simp.status, rounds: String(simp.rounds), oracle: simp.oracle },
            });
          }

          let rollupVerdict: "verified" | "partial" | "failed" | "unverified" | "skipped" = "skipped";
          if (opts.verify) {
            phase = "verify";
            // Arm the completion gate for THIS run (Frente C): from here a session
            // Stop is blocked unless verify writes a passing verdict for rootSpec.
            // The rollup verify below clears the sentinel on a matching pass.
            markRunActive(rootSpec, cwd);
            console.log(kleur.cyan("→ phase 4/5  per-sub-Spec /verify (parallel, blind Opus)"));
            const verifications = await Promise.all(
              multispec.subSpecs.map((s) =>
                safeVerify(s, { cwd, confidenceThreshold, adversarial: opts.adversarial }),
              ),
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
            const rollup = await safeVerify(rootSpec, { cwd, confidenceThreshold, adversarial: opts.adversarial });
            rollupVerdict = rollup.verdict;
            const c = rollup.verdict === "verified" ? kleur.green : rollup.verdict === "partial" ? kleur.yellow : kleur.red;
            console.log(c(`  rollup: ${rollup.verdict}`));

            // SSC easy-pass re-check (Frente A.2): a verdict that passed too easily is
            // re-examined, not accepted. Always warn; with --ssc, escalate to an
            // adversarial re-verify whose verdict supersedes.
            const easy = detectEasyPass(rootSpec, rollup);
            if (easy.suspicious) {
              console.log(kleur.yellow(`  ⚠ verify passed but looks too easy: ${easy.reasons.join("; ")}`));
              if (opts.ssc) {
                console.log(kleur.cyan("  → SSC re-examination: adversarial re-verify"));
                const reverify = await safeVerify(rootSpec, { cwd, confidenceThreshold, adversarial: true });
                rollupVerdict = reverify.verdict;
                console.log(
                  (reverify.verdict === "verified" ? kleur.green : kleur.yellow)(`    re-verify: ${reverify.verdict}`),
                );
              }
            }
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // An Anthropic session/rate limit is a pause, not a logic failure: the
          // sub-Spec work that completed before the interrupt is already on disk.
          // Surface that legibly with a recovery command instead of a bare error.
          if (isSaturationSignal(msg)) {
            const reset = parseResetTime(msg);
            const buildLanded = phase === "goal" || phase === "verify";
            try {
              memory.recordRun({
                specTitle: goal.slice(0, 80),
                goal,
                status: "blocked",
                costUsd: 0,
                tokensIn: 0,
                tokensOut: 0,
                durationMs: Date.now() - started,
                plan: plan.plan,
                mode: opts.mode,
                evidence: { interrupted: true, phase, signal: "saturation", resetsAt: reset?.toISOString() ?? null },
              });
            } catch {
              /* memory write is best-effort during an interrupt */
            }
            memory.close();
            console.error(
              "\n" +
                kleur.yellow("⚠ interrupted by an Anthropic session/rate limit") +
                kleur.dim(` (at phase: ${phase}) — NOT a logic failure.`),
            );
            if (reset) console.error(kleur.dim(`  pool resets ~${reset.toLocaleString()}`));
            if (buildLanded) {
              console.error(
                kleur.dim("  Completed sub-Spec work is on disk. After the reset, recover WITHOUT a rebuild:\n") +
                  "    " +
                  kleur.cyan("cmax verify") +
                  kleur.dim("   (runs only the blind Opus verify against SPEC.md)\n") +
                  kleur.dim("  Then run your local gate (typecheck / test / lint) and commit what is green."),
              );
            } else {
              console.error(
                kleur.dim("  Decompose had not completed — little/no work on disk. Re-run after the reset:\n") +
                  "    " +
                  kleur.cyan('cmax ask "<your goal>"'),
              );
            }
            process.exit(3);
          }
          memory.close();
          throw err;
        }
      },
    );
}

// Isolate a per-sub-Spec verify failure so one throw can't abort the whole run
// (the Promise.all over verifies). The isolated sub-Spec is recorded as failed
// with the error in notes — honest, never a silent pass.
async function safeVerify(
  spec: Spec,
  opts: { cwd: string; confidenceThreshold: number; adversarial: boolean },
): Promise<VerificationReport> {
  try {
    return await verify(spec, {
      cwd: opts.cwd,
      confidenceThreshold: opts.confidenceThreshold,
      adversarial: opts.adversarial,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      spec,
      perCondition: [],
      suppressedLowConfidence: [],
      verdict: "failed",
      verifierTier: "opus",
      notes: `verify threw and was isolated: ${reason}`,
      confidenceThreshold: opts.confidenceThreshold,
    };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Opus 4.8 effort for execution lanes. We expose only the meaningful upper range
// (high|xhigh|max); xhigh is the default and the SOTA-2026 sweet spot. Anything
// else (typo, low/medium) falls back to xhigh — use --variant opussonnet for the
// cost-conscious path, not a lower effort.
function normalizeEffort(v: string): EffortLevel {
  return v === "high" || v === "xhigh" || v === "max" ? v : "xhigh";
}

const TEST_RE = /\b(?:test|spec|vitest|jest|pytest|cargo test|go test|pnpm test|npm test|yarn test)\b/i;
function hasTestVerifyHint(spec: Spec): boolean {
  return spec.completionConditions.some((cc) => TEST_RE.test(cc.verifyHint));
}
