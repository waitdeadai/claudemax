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
    .description("Describe your goal. claudemax does deepresearch + multispec + parallel /goal + verify. Power-user entry point.")
    .argument("<goal>", "what you want to ship, in quotes")
    .option("--out <path>", "where to write the root SPEC.md", "SPEC.md")
    .option("--max-turns <n>", "goal-loop turn budget per sub-Spec", "200")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions | auto",
      "acceptEdits",
    )
    .option("--variant <variant>", "opussonnet | opusolo", "opussonnet")
    .option("--mode <mode>", "auto | solo | teams", "auto")
    .option("--no-research", "skip /deepresearch (smaller / simpler goals)")
    .option("--no-verify", "skip independent verification step")
    .option("--tdd", "enforce write-failing-test-first per sub-Spec where a test verifyHint exists", false)
    .option("--confidence <n>", "verifier confidence threshold for primary findings (0..1)", "0.8")
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
      console.log();

      const runCmd = runCommand();
      const argv = ["node", "cmax", "run", goal];
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === "boolean") {
          if (k === "research" && v === false) argv.push("--no-research");
          else if (k === "verify" && v === false) argv.push("--no-verify");
          else if (k === "tdd" && v === true) argv.push("--tdd");
        } else if (v !== undefined) {
          const flag = k.replace(/([A-Z])/g, "-$1").toLowerCase();
          argv.push(`--${flag}`, String(v));
        }
      }
      await runCmd.parseAsync(argv);
    });

  return cmd;
}
