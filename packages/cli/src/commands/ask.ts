import { Command } from "commander";
import kleur from "kleur";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "./run.js";

// `cmax ask` is the friendly entry point for "describe your goal and achieve it".
// It's a thin wrapper over `cmax run` that:
//   1. Detects whether the project has a taste.md / taste.vision kernel.
//      If not, prints a one-line nudge before handing off to the multispec pipeline.
//   2. Prints a phase banner so the user feels the SOTA workflow engaging.
//
// The actual pipeline is identical to `cmax run`:
//   /deepresearch → multispec decompose → /specqa → /introspect →
//   parallel /goal per sub-Spec → per-sub-Spec /verify → rollup /verify
//
// Anyone who knows the verb "ask" can drive claudemax. Power-user flags
// (--variant, --mode, --max-turns, --no-research, --no-verify) live on `cmax run`.

export function askCommand(): Command {
  // Reuse run's action but expose it under the friendlier verb.
  // We construct a fresh Command with the same surface to avoid mutating run.
  const cmd = new Command("ask")
    .description("Describe your goal → production-ready, autonomously. deepresearch + multispec + parallel /goal + decomposed evidence-gated verify, hardened by default (PRC + SSC + adversarial). Lighten with --mvp / --no-ssc / --no-adversarial.")
    .argument("<goal>", "what you want to ship, in quotes")
    .option("--out <path>", "where to write the root SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "goal-loop turn budget per sub-Spec", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions | auto",
      "bypassPermissions",
    )
    .option("--variant <variant>", "opussonnet | opusolo", "opussonnet")
    .option("--mode <mode>", "auto | solo | teams", "auto")
    .option("--no-research", "skip /deepresearch (smaller / simpler goals)")
    .option("--no-verify", "skip independent verification step")
    .option("--tdd", "enforce write-failing-test-first per sub-Spec where a test verifyHint exists", false)
    .option("--confidence <n>", "verifier confidence threshold for primary findings (0..1)", "0.8")
    .option("--no-ssc", "disable Specification Self-Correction (ON by default — hardens each sub-Spec before execution)")
    .option("--no-adversarial", "disable adversarial verify (ON by default — stress-tests the blind verifier with mutants + isomorphic restatement)")
    .option("--mvp", "ship an MVP instead of production-ready (skips the PRC bar)", false)
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .action(async (goal: string, opts: Record<string, unknown>) => {
      const cwd = process.cwd();
      const hasTaste = existsSync(resolve(cwd, "taste.md")) || existsSync(resolve(cwd, "taste.vision"));

      console.log(
        kleur.bold("\n  claudemax  ") +
          kleur.dim("/  ask → deepresearch → multispec → parallel /goal → verify  /\n"),
      );
      console.log(kleur.cyan(`  goal:    `) + goal);
      console.log(
        kleur.cyan(`  taste:   `) +
          (hasTaste
            ? kleur.green("present (taste.md / taste.vision loaded by SessionStart hook)")
            : kleur.yellow("not bootstrapped — run `cmax taste init` for project kernel grounding")),
      );
      console.log(
        kleur.cyan(`  variant: `) +
          String(opts["variant"] ?? "opussonnet") +
          kleur.dim("   (--variant opusolo for max effectiveness on novel/security work)"),
      );
      console.log(
        kleur.cyan(`  mode:    `) +
          String(opts["mode"] ?? "auto") +
          kleur.dim("        (auto-selects Mode A SDK subagents or Mode B Claude Code Agent Teams per spec shape)"),
      );
      console.log(
        kleur.cyan(`  bar:     `) +
          (opts["mvp"] ? kleur.yellow("MVP (--mvp)") : kleur.green("production-ready (PRC)")) +
          kleur.dim(
            `   ssc=${opts["ssc"] === false ? "off" : "on"} adversarial=${opts["adversarial"] === false ? "off" : "on"}   (decomposed evidence-gated verify is the source of truth)`,
          ),
      );
      console.log();

      const runCmd = runCommand();
      // Bug fix: when parseAsync is called on the `run` subcommand directly,
      // it expects argv in node format ["node","script", ...args]. The argv
      // strips the first two then parses the REST as the run command's args.
      // Including "run" in argv made commander interpret "run" as the goal
      // positional and the real goal as a second positional → "too many
      // arguments. Expected 1 argument but got 2."
      const argv = ["node", "cmax", goal];
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === "boolean") {
          if (k === "research" && v === false) argv.push("--no-research");
          else if (k === "verify" && v === false) argv.push("--no-verify");
          else if (k === "tdd" && v === true) argv.push("--tdd");
          // ask hardens by default: ssc + adversarial are ON unless --no-ssc /
          // --no-adversarial. run only understands the positive flags, so forward
          // them only when true (a false value simply omits the flag).
          else if (k === "ssc" && v === true) argv.push("--ssc");
          else if (k === "adversarial" && v === true) argv.push("--adversarial");
          else if (k === "mvp" && v === true) argv.push("--mvp");
        } else if (v !== undefined) {
          const flag = k.replace(/([A-Z])/g, "-$1").toLowerCase();
          argv.push(`--${flag}`, String(v));
        }
      }
      await runCmd.parseAsync(argv);
    });

  return cmd;
}
