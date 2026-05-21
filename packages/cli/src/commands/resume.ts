import { Command } from "commander";
import kleur from "kleur";
import {
  findLatestResumableRun,
  readResumableState,
  resumableStateDir,
  pendingLanes,
  isComplete,
} from "@claudemax/runtime";
import { driveLanes } from "./mega.js";

export function resumeCommand(): Command {
  return new Command("resume")
    .description("Resume a paused `cmax mega` run. Picks up only the lanes that are still pending/paused. cron-friendly: exits 0 with no-op if nothing to do.")
    .argument("[run-id]", "run id (e.g. run-1234567890); omitted = latest run in cwd")
    .option("--max-parallel <n>", "override lane cap")
    .action(async (runIdArg: string | undefined, opts: { maxParallel?: string }) => {
      const cwd = process.cwd();
      const runId = runIdArg ?? findLatestResumableRun(cwd);
      if (!runId) {
        console.log(kleur.dim("no resumable run found in .claudemax/state/resumable/"));
        process.exit(0);
      }
      const state = readResumableState(cwd, runId);
      if (!state) {
        console.error(kleur.red(`run ${runId} not found at ${resumableStateDir(cwd, runId)}`));
        process.exit(2);
      }
      if (isComplete(state)) {
        console.log(kleur.green(`run ${runId}: already complete; nothing to resume`));
        process.exit(0);
      }
      const pending = pendingLanes(state);
      console.log(kleur.bold(`\n  cmax resume  `) + kleur.dim(`/  run=${runId}  pending=${pending.length}  /\n`));
      const maxParallel = opts.maxParallel
        ? Number(opts.maxParallel)
        : state.orchestrateFlags.maxParallel ?? pending.length;

      await driveLanes(state, maxParallel, {
        variant: state.orchestrateFlags.variant ?? "opussonnet",
        confidence: String(state.orchestrateFlags.confidence ?? 0.85),
        mode: state.orchestrateFlags.mode ?? "auto",
        tdd: state.orchestrateFlags.tdd !== false,
      });
    });
}
