import { Command } from "commander";
import kleur from "kleur";
import { rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { MODELS } from "@claudemax/core";
import {
  writeSpec,
  runConvergeLoop,
  runPipelineLoop,
  defaultStandingLoopDeps,
  runStandingLoopTick,
  saveStandingLoopSpec,
  loadStandingLoopSpec,
  listStandingLoops,
  loadStandingLoopState,
  setStandingLoopStatus,
  loadLedger,
  fleetBudgetStatus,
  loopStateDir,
  prepareArm,
  dryFire,
  readScheduleState,
  deleteScheduleState,
  type LoopSource,
  type StandingLoopSpec,
  type ScheduleSpec,
} from "@claudemax/runtime";

// `cmax loop` — the first-class "loop everything" surface (docs/LOOP_MODE_PLAN.md).
// Two archetypes:
//   loop run "<goal>"   — converge-loop: drive ONE goal to DONE (Archetype A)
//   loop add <name> ... — standing-loop: a scheduled, input-driven fleet member
//                          that senses, decides, builds, verifies, reports (B)
// Plus the fleet control plane: tick / ls / status / pause / resume / kill.
// No native `/loop` collision — this is `cmax loop`, not a slash command.
export function loopCommand(): Command {
  const cmd = new Command("loop").description(
    "Loop everything — converge a goal to DONE, or run a standing, scheduled, input-driven loop fleet (verify-gated, budget-guarded).",
  );

  cmd
    .command("run <goal>")
    .description(
      "Loop a goal to a verified DONE. Default body = the FULL cmax pipeline (deepresearch + multispec + parallel /goal + blind rollup verify), looped with respec-on-stall + budget ceilings. Use --lean for the single-spec converge-loop.",
    )
    .option("--lean", "lean body: single spec → /goal → verify (no deepresearch/multispec)", false)
    .option("--max-passes <n>", "pass ceiling", "4")
    .option("--max-credit <usd>", "credit ceiling across all passes", "60")
    .option("--max-turns <n>", "per-sub /goal turn cap (per-pass cap with --lean)", "120")
    .option("--respec-after <n>", "consecutive no-progress passes before re-spec / re-decompose", "2")
    .option("--no-research", "skip deepresearch in CONSTRUCT (pipeline body only)")
    .option("--ssc", "harden sub-Specs before execution (pipeline body only)", false)
    .option("--adversarial", "adversarial rollup verify (pipeline body only)", false)
    .option("--mvp", "MVP bar instead of production-ready (pipeline body only)", false)
    .option("--opusolo", "run the executor on Opus too (higher ceiling, higher cost)", false)
    .action(
      async (
        goal: string,
        opts: {
          lean: boolean;
          maxPasses: string;
          maxCredit: string;
          maxTurns: string;
          respecAfter: string;
          research: boolean;
          ssc: boolean;
          adversarial: boolean;
          mvp: boolean;
          opusolo: boolean;
        },
      ) => {
        const cwd = process.cwd();
        const model = opts.opusolo ? MODELS.opus.id : undefined;

        if (opts.lean) {
          console.log(kleur.cyan(`→ loop run --lean: constructing spec for "${goal.slice(0, 60)}"…`));
          const spec = await writeSpec(goal, { cwd });
          console.log(kleur.dim(`  spec: ${spec.title} (${spec.completionConditions.length} conditions)`));
          const res = await runConvergeLoop(spec, {
            cwd,
            maxPasses: Number(opts.maxPasses),
            maxCreditUsd: Number(opts.maxCredit),
            maxTurnsPerPass: Number(opts.maxTurns),
            respecAfterStuck: Number(opts.respecAfter),
            model,
            onPass: (pass, action, reason) =>
              console.log(
                kleur.dim(
                  `  pass ${pass.index}: ${pass.passedConditions}/${pass.totalConditions} verified → ${action} (${reason})`,
                ),
              ),
          });
          reportFinal(res.finalAction, res.passes.length, res.totalCreditUsd, res.respecs);
          return;
        }

        console.log(
          kleur.bold("\n  cmax loop  ") +
            kleur.dim("/  deepresearch → multispec → parallel /goal → rollup verify, looped  /\n"),
        );
        console.log(kleur.cyan(`  goal: `) + goal);
        const res = await runPipelineLoop(goal, {
          cwd,
          research: opts.research,
          ssc: opts.ssc,
          adversarial: opts.adversarial,
          mvp: opts.mvp,
          maxPasses: Number(opts.maxPasses),
          maxCreditUsd: Number(opts.maxCredit),
          maxTurnsPerSub: Number(opts.maxTurns),
          respecAfterStuck: Number(opts.respecAfter),
          model,
          onPhase: (m) => console.log(kleur.cyan(`→ ${m}`)),
          onPass: (pass, action, reason) =>
            console.log(
              kleur.dim(
                `  pass ${pass.index}: rollup ${pass.verdict} ${pass.passedConditions}/${pass.totalConditions} → ${action} (${reason})`,
              ),
            ),
        });
        reportFinal(res.finalAction, res.passes.length, res.totalCreditUsd, res.respecs);
      },
    );

  cmd
    .command("add <name>")
    .description("Register a standing-loop (Archetype B): sense → decide → build → verify → report, on a schedule.")
    .requiredOption("--intent <text>", "what the loop should watch for and build")
    .requiredOption("--schedule <cron>", "cron expression (5-field) for the tick cadence")
    .option(
      "--source <spec>",
      "input source: github-prs[:query] | github-issues[:query] | shell:<command> (repeatable)",
      collect,
      [] as string[],
    )
    .option("--max-items <n>", "max work items acted on per tick", "3")
    .option("--max-credit <usd>", "per-tick credit cap", "10")
    .option("--per-item-credit <usd>", "credit cap for each item's converge-loop", "5")
    .option("--arm", "arm a systemd-user timer to run ticks on the schedule (else just persist + print)", false)
    .action(
      (
        name: string,
        opts: {
          intent: string;
          schedule: string;
          source: string[];
          maxItems: string;
          maxCredit: string;
          perItemCredit: string;
          arm: boolean;
        },
      ) => {
        const cwd = process.cwd();
        if (!opts.source.length) {
          console.error(kleur.red("error: at least one --source is required"));
          process.exit(2);
        }
        let sources: LoopSource[];
        try {
          sources = opts.source.map(parseSource);
        } catch (err) {
          console.error(kleur.red(`error: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(2);
          return;
        }
        const spec: StandingLoopSpec = {
          name,
          intent: opts.intent,
          schedule: opts.schedule,
          sources,
          maxItemsPerTick: Number(opts.maxItems),
          maxCreditUsdPerTick: Number(opts.maxCredit),
          perItemCreditUsd: Number(opts.perItemCredit),
          createdAt: new Date().toISOString(),
        };
        saveStandingLoopSpec(cwd, spec);
        console.log(kleur.green(`  ✓ standing-loop '${name}' registered`));
        console.log(kleur.dim(`    intent:   ${spec.intent}`));
        console.log(kleur.dim(`    schedule: ${spec.schedule}`));
        console.log(kleur.dim(`    sources:  ${sources.map(describeSource).join(", ")}`));

        const tickCmd = [process.execPath, process.argv[1]!, "loop", "tick", name];
        if (!opts.arm) {
          console.log(
            kleur.yellow(`\n  not armed. To schedule it, run:\n    `) +
              `cmax schedule run loop-${name} ${tickCmd.join(" ")} --cron "${spec.schedule}" --resume-on-limit`,
          );
          return;
        }
        armTick(name, spec.schedule, tickCmd, cwd);
      },
    );

  cmd
    .command("tick <name>")
    .description("Run ONE tick of a standing-loop. This is what the scheduler invokes; can also be run by hand.")
    .action(async (name: string) => {
      const cwd = process.cwd();
      const spec = loadStandingLoopSpec(cwd, name);
      if (!spec) {
        console.error(kleur.red(`error: no standing-loop named '${name}' in ${cwd}`));
        process.exit(1);
        return;
      }
      const deps = defaultStandingLoopDeps(spec, { cwd, perItemCreditUsd: spec.perItemCreditUsd });
      const out = await runStandingLoopTick(spec, deps, { cwd });
      if (out.paused) {
        console.log(kleur.yellow(`  ${name} is paused — tick skipped`));
        return;
      }
      console.log(
        kleur.dim(
          `  tick: sensed=${out.sensed} considered=${out.considered} acted=${out.acted.length} skipped=${out.skippedAlreadyDone} credit=$${out.creditUsd.toFixed(2)}${out.budgetStopped ? " (budget-stopped)" : ""}`,
        ),
      );
    });

  cmd
    .command("ls")
    .description("List standing-loops with status, ledger size, and cumulative spend; show the fleet budget.")
    .action(() => {
      const cwd = process.cwd();
      const loops = listStandingLoops(cwd);
      const fleet = fleetBudgetStatus(cwd);
      if (!loops.length) {
        console.log(kleur.dim("(no standing-loops in this cwd) — create one with `cmax loop add`"));
      } else {
        console.log(kleur.bold("name                 status   ticks  ledger  spend     schedule"));
        for (const l of loops) {
          const st = loadStandingLoopState(cwd, l.name);
          const led = loadLedger(cwd, l.name);
          const spend = led.entries.reduce((a, e) => a + (Number(e.creditUsd) || 0), 0);
          console.log(
            `${l.name.padEnd(20)} ${st.status.padEnd(8)} ${String(st.ticks).padStart(5)}  ${String(led.entries.length).padStart(6)}  $${spend.toFixed(2).padStart(7)}  ${l.schedule}`,
          );
        }
      }
      console.log(
        kleur.dim(
          `\nfleet: $${fleet.spentUsd.toFixed(2)} spent [${fleet.tag}] — plan ${fleet.plan}, era ${fleet.era}${fleet.monthlyCreditUsd ? `, $${fleet.monthlyCreditUsd}/mo envelope` : ""}`,
        ),
      );
    });

  cmd
    .command("status <name>")
    .description("Show a standing-loop's spec, run-state, ledger summary, and recent ticks.")
    .option("--tail <n>", "tick-log tail length", "10")
    .action((name: string, opts: { tail: string }) => {
      const cwd = process.cwd();
      const spec = loadStandingLoopSpec(cwd, name);
      if (!spec) {
        console.error(kleur.red(`error: no standing-loop named '${name}' in ${cwd}`));
        process.exit(1);
        return;
      }
      const st = loadStandingLoopState(cwd, name);
      const led = loadLedger(cwd, name);
      console.log(kleur.bold(`standing-loop: ${spec.name}`));
      console.log(`  status:    ${st.status}`);
      console.log(`  intent:    ${spec.intent}`);
      console.log(`  schedule:  ${spec.schedule}`);
      console.log(`  sources:   ${spec.sources.map(describeSource).join(", ")}`);
      console.log(`  ticks:     ${st.ticks}  (last: ${st.lastTickAt ?? "never"})`);
      console.log(`  ledger:    ${led.entries.length} item(s) acted on`);
      console.log(`  caps:      ${spec.maxItemsPerTick} items/tick, $${spec.maxCreditUsdPerTick}/tick, $${spec.perItemCreditUsd}/item`);
      const logPath = `${loopStateDir(cwd, name)}/ticks.log`;
      if (existsSync(logPath)) {
        console.log(kleur.dim(`\nrecent ticks (${opts.tail}):`));
        spawnSync("tail", ["-n", opts.tail, logPath], { stdio: "inherit" });
      }
    });

  cmd
    .command("pause <name>")
    .description("Pause a standing-loop (ticks no-op until resumed).")
    .action((name: string) => flipStatus(name, "paused"));

  cmd
    .command("resume <name>")
    .description("Resume a paused standing-loop.")
    .action((name: string) => flipStatus(name, "active"));

  cmd
    .command("kill <name>")
    .description("Stop the schedule timer and delete all state for a standing-loop.")
    .action((name: string) => {
      const cwd = process.cwd();
      if (!loadStandingLoopSpec(cwd, name)) {
        console.error(kleur.red(`error: no standing-loop named '${name}' in ${cwd}`));
        process.exit(1);
        return;
      }
      const sched = readScheduleState(cwd, `loop-${name}`);
      const timer = sched?.systemdUnit?.replace(".service", ".timer");
      if (timer) {
        spawnSync("systemctl", ["--user", "stop", timer], { stdio: "inherit" });
        deleteScheduleState(cwd, `loop-${name}`);
      }
      rmSync(loopStateDir(cwd, name), { recursive: true, force: true });
      console.log(kleur.green(`  ✓ killed standing-loop '${name}'`));
    });

  return cmd;
}

function flipStatus(name: string, status: "active" | "paused"): void {
  const cwd = process.cwd();
  if (!setStandingLoopStatus(cwd, name, status)) {
    console.error(kleur.red(`error: no standing-loop named '${name}' in ${cwd}`));
    process.exit(1);
    return;
  }
  console.log(kleur.green(`  ✓ ${name} → ${status}`));
}

function armTick(name: string, schedule: string, command: string[], cwd: string): void {
  const spec: ScheduleSpec = {
    name: `loop-${name}`,
    kind: "cron",
    when: schedule,
    command,
    cwd,
    resumeOnLimit: true,
  };
  console.log(kleur.dim("  dry-firing the tick command before arming…"));
  const dry = dryFire(spec.command, cwd);
  if (!dry.ok) {
    console.error(kleur.red(`  dry-fire failed (exit ${dry.exitCode}); not arming. The timer would die the same way.`));
    if (dry.stderr) console.error(kleur.dim(`  stderr: ${dry.stderr.slice(0, 400)}`));
    process.exit(1);
  }
  const armed = prepareArm(spec);
  const r = spawnSync(armed.systemdArgs[0]!, armed.systemdArgs.slice(1), { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(kleur.red(`  systemd-run failed (exit ${r.status ?? -1}). Is systemd --user available?`));
    process.exit(r.status ?? 1);
  }
  console.log(kleur.green(`  ✓ armed. inspect: cmax schedule status loop-${name}`));
}

function reportFinal(action: string, passes: number, creditUsd: number, respecs: number): void {
  const sc = action === "done" ? kleur.green : action === "blocked" ? kleur.yellow : kleur.red;
  console.log(
    sc(`\n${action}`) + kleur.dim(` after ${passes} pass(es), $${creditUsd.toFixed(2)}, ${respecs} respec(s)`),
  );
  process.exit(action === "done" ? 0 : 1);
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function parseSource(raw: string): LoopSource {
  const idx = raw.indexOf(":");
  const kind = idx === -1 ? raw : raw.slice(0, idx);
  const rest = idx === -1 ? "" : raw.slice(idx + 1);
  if (kind === "github-prs") return rest ? { kind, query: rest } : { kind };
  if (kind === "github-issues") return rest ? { kind, query: rest } : { kind };
  if (kind === "shell") {
    if (!rest) throw new Error("shell source needs a command: --source shell:<command>");
    return { kind: "shell", command: rest };
  }
  throw new Error(`unknown source kind '${kind}' (expected github-prs | github-issues | shell)`);
}

function describeSource(s: LoopSource): string {
  if (s.kind === "shell") return `shell:${s.command}`;
  return s.query ? `${s.kind}:${s.query}` : s.kind;
}
