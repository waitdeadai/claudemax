import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DispatchPlan } from "@claudemax/core";
import { dispatch, summarizeDispatch } from "@claudemax/runtime";

export function dispatchCommand(): Command {
  return new Command("dispatch")
    .description("Parallel subagent fan-out for a DispatchPlan JSON")
    .argument("<plan>", "path to a DispatchPlan JSON file")
    .option("--max-parallel <n>", "cap on simultaneous workers", "")
    .option(
      "--permission <mode>",
      "default | acceptEdits | plan | bypassPermissions",
      "acceptEdits",
    )
    .action(async (planPath: string, opts: { maxParallel: string; permission: string }) => {
      const raw = readFileSync(resolve(process.cwd(), planPath), "utf8");
      const plan = JSON.parse(raw) as DispatchPlan;
      console.log(
        kleur.cyan(
          `→ dispatching ${plan.packets.length} packets in ${plan.parallelGroups.length} group(s)`,
        ),
      );
      const results = await dispatch(plan, {
        maxParallel: opts.maxParallel ? Number(opts.maxParallel) : undefined,
        permissionMode: opts.permission as "default" | "acceptEdits" | "plan" | "bypassPermissions",
        onPacketStart: (p) => console.log(kleur.dim(`  start  ${p.id}  ${p.title}`)),
        onPacketEnd: (r) =>
          console.log(
            (r.success ? kleur.green : kleur.red)(
              `  ${r.success ? "ok    " : "fail  "} ${r.packetId}  ${kleur.dim(r.tier)}  ${r.durationMs}ms`,
            ),
          ),
      });
      const s = summarizeDispatch(results);
      console.log(kleur.bold(`\nsummary`));
      console.log(`  ok:       ${kleur.green(String(s.successCount))}`);
      console.log(`  fail:     ${kleur.red(String(s.failureCount))}`);
      console.log(`  tokens:   in=${s.totalTokensIn}  out=${s.totalTokensOut}`);
      console.log(`  cost:     $${s.totalCostUsd.toFixed(4)}`);
      console.log(`  by tier:  ${JSON.stringify(s.byTier)}`);
      process.exit(s.failureCount === 0 ? 0 : 1);
    });
}
