import { Command } from "commander";
import kleur from "kleur";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMultiOrchestrator, type GoalRunRecord } from "@claudemax/runtime";

export function orchestrateCommand(): Command {
  return new Command("orchestrate")
    .alias("multi")
    .description("Run N cmax-ask pipelines in parallel for different goals. Live status table; rollup verdict at end. Effectiveness defaults: --tdd --confidence 0.85.")
    .argument("[goals...]", "goals as separate quoted strings; or use --goals-file")
    .option("--goals-file <path>", "newline-separated goals file (one goal per line; # comments allowed)")
    .option("--max-parallel <n>", "cap on concurrent cmax-ask subprocesses (default: all)")
    .option("--variant <variant>", "opussonnet | opusolo (per-goal exec tier)", "opussonnet")
    .option("--mode <mode>", "auto | solo | teams (per-goal parallelism mode)", "auto")
    .option("--no-tdd", "skip the TDD enforcement (default ON)")
    .option("--confidence <n>", "verifier confidence threshold per goal", "0.85")
    .option("--tick-ms <n>", "live status refresh interval in ms", "5000")
    .action(
      async (
        goalsArgs: string[],
        opts: {
          goalsFile?: string;
          maxParallel?: string;
          variant: "opussonnet" | "opusolo";
          mode: "auto" | "solo" | "teams";
          tdd: boolean;
          confidence: string;
          tickMs: string;
        },
      ) => {
        const goals = collectGoals(goalsArgs, opts.goalsFile);
        if (goals.length === 0) {
          console.error(kleur.red("error: no goals provided. Pass goals as quoted args or --goals-file <path>."));
          process.exit(2);
        }

        console.log(
          kleur.bold(`\n  cmax orchestrate  `) +
            kleur.dim(`/  ${goals.length} parallel pipelines, each: deepresearch → multispec → /goal → verify  /\n`),
        );
        console.log(kleur.yellow(`  pre-split era reminder: each parallel cmax-ask draws from your shared 5h subscription pool today. N parallel goals = N× faster envelope burn.\n`));
        for (const [i, g] of goals.entries()) {
          console.log(kleur.cyan(`  ${i + 1}. `) + g);
        }
        console.log();

        const tickMs = Number(opts.tickMs);
        let lastPrint = 0;
        const r = await runMultiOrchestrator(goals, {
          cwd: process.cwd(),
          tdd: opts.tdd !== false,
          confidence: Number(opts.confidence),
          variant: opts.variant,
          mode: opts.mode,
          maxParallel: opts.maxParallel ? Number(opts.maxParallel) : undefined,
          tickMs,
          onUpdate: (snap) => {
            const now = Date.now();
            if (now - lastPrint < tickMs - 100) return;
            lastPrint = now;
            printStatusTable(snap);
          },
        });

        console.log(kleur.bold("\n=== rollup ==="));
        printStatusTable(r.perGoal);
        const color =
          r.verdict === "all-finished" ? kleur.green : r.verdict === "partial" ? kleur.yellow : kleur.red;
        console.log(color(`\n${r.verdict.toUpperCase()}  (${(r.durationMs / 1000).toFixed(1)}s total)`));
        process.exit(r.verdict === "all-finished" ? 0 : 1);
      },
    );
}

function collectGoals(args: readonly string[], filePath: string | undefined): readonly string[] {
  const fromArgs = args.map((g) => g.trim()).filter(Boolean);
  if (filePath) {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    const fromFile = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return [...fromArgs, ...fromFile];
  }
  return fromArgs;
}

function printStatusTable(records: readonly GoalRunRecord[]): void {
  const now = Date.now();
  console.log(kleur.dim(`  ─── status @ ${new Date().toISOString().slice(11, 19)} ───`));
  for (const r of records) {
    const elapsed = ((r.finishedAt ?? now) - r.startedAt) / 1000;
    const statusColor =
      r.status === "finished"
        ? kleur.green
        : r.status === "partial"
          ? kleur.yellow
          : r.status === "running" || r.status === "pending"
            ? kleur.cyan
            : kleur.red;
    const elapsedStr = `${elapsed.toFixed(0)}s`.padStart(6);
    console.log(`  ${statusColor(r.status.padEnd(8))} ${elapsedStr}  ${kleur.bold(r.id.padEnd(40))} ${kleur.dim(truncate(r.goal, 60))}`);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
