import { Command } from "commander";
import kleur from "kleur";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  prepareArm,
  dryFire,
  parseResetTime,
  toSystemdCalendar,
  withSafetyMargin,
  listScheduleStates,
  readScheduleState,
  deleteScheduleState,
  discoverFullPath,
  type ScheduleKind,
  type ScheduleSpec,
} from "@claudemax/runtime";

export function scheduleCommand(): Command {
  const cmd = new Command("schedule").description(
    "SOTA-2026 reset-aware systemd-user-timer scheduler. Bakes nvm/cargo PATH into the unit, dry-fires the command before arming, and reschedules itself on Anthropic rate-limit hits.",
  );

  cmd
    .command("run <name> <executable...>")
    .description(
      "Schedule an executable. One of --at, --cron, or --every is required. Dry-fires the executable before arming the timer; aborts if dry-fire fails.",
    )
    .option("--at <iso-or-systemd>", "one-shot fire time (ISO 8601 or systemd calendar form)")
    .option("--cron <expression>", "cron expression (5-field; parsed via croner)")
    .option("--every <duration>", "fire every <duration> (e.g. 15m, 6h, 1d)")
    .option("--resume-on-limit", "auto-reschedule on Anthropic rate-limit hit", false)
    .option("--max-iterations <n>", "stop after N iterations (0 = unbounded)", "0")
    .option("--log <path>", "log path (defaults to .claudemax/scheduled/<name>.log)")
    .option("--skip-dry-fire", "skip pre-arm dry-fire (NOT recommended)", false)
    .option("--description <text>", "human-readable description for systemd")
    .action(
      (
        name: string,
        executable: readonly string[],
        opts: {
          at?: string;
          cron?: string;
          every?: string;
          resumeOnLimit: boolean;
          maxIterations: string;
          log?: string;
          skipDryFire: boolean;
          description?: string;
        },
      ) => {
        const cwd = process.cwd();
        const provided = [opts.at, opts.cron, opts.every].filter(Boolean);
        if (provided.length !== 1) {
          console.error(
            kleur.red("error: provide exactly one of --at, --cron, --every"),
          );
          process.exit(2);
        }

        let kind: ScheduleKind;
        let when: string;
        if (opts.at) {
          kind = "at";
          when = opts.at;
        } else if (opts.cron) {
          kind = "cron";
          when = opts.cron;
        } else {
          kind = "every";
          when = opts.every!;
        }

        const spec: ScheduleSpec = {
          name,
          kind,
          when,
          command: executable as readonly string[],
          cwd,
          resumeOnLimit: opts.resumeOnLimit,
          maxIterations: opts.maxIterations ? Number(opts.maxIterations) : undefined,
          logPath: opts.log,
          description: opts.description,
        };

        if (!opts.skipDryFire) {
          console.log(kleur.dim("dry-firing under simulated systemd minimal env..."));
          const r = dryFire(spec.command, cwd);
          if (!r.ok) {
            console.error(
              kleur.red(
                `dry-fire failed (exit ${r.exitCode}). The systemd timer would die the same way. Aborting before arming.`,
              ),
            );
            console.error(kleur.dim(`simulated PATH: ${r.simulatedPath}`));
            if (r.stderr) console.error(kleur.dim(`stderr: ${r.stderr.slice(0, 500)}`));
            console.error(
              kleur.yellow(
                "fix: ensure the executable is reachable via the PATH printed above; or pass --skip-dry-fire to arm anyway.",
              ),
            );
            process.exit(1);
          }
          console.log(kleur.green("  ✓ dry-fire passed"));
        }

        const armed = prepareArm(spec);
        console.log(kleur.cyan("arming systemd-run user timer..."));
        console.log(kleur.dim(`  unit:     ${armed.state.systemdUnit}`));
        console.log(kleur.dim(`  wrapper:  ${armed.wrapperPath}`));
        console.log(kleur.dim(`  log:      ${armed.state.logPath}`));
        console.log(kleur.dim(`  PATH:     ${armed.pathEnv}`));

        const r = spawnSync(armed.systemdArgs[0]!, armed.systemdArgs.slice(1), {
          stdio: "inherit",
        });
        if (r.status !== 0) {
          console.error(
            kleur.red(
              `systemd-run failed (exit ${r.status ?? -1}). Check: systemctl --user status ${armed.state.systemdUnit?.replace(".service", ".timer")}`,
            ),
          );
          process.exit(r.status ?? 1);
        }
        console.log(
          kleur.green(`  ✓ armed. inspect: cmax schedule status ${name}`),
        );
      },
    );

  cmd
    .command("list")
    .description("List schedules in the current cwd's .claudemax/scheduled/")
    .action(() => {
      const states = listScheduleStates(process.cwd());
      if (!states.length) {
        console.log(kleur.dim("(no schedules in this cwd)"));
        return;
      }
      console.log(kleur.bold("name                    status     iterations  next-fire"));
      for (const s of states) {
        console.log(
          `${s.name.padEnd(24)} ${(s.status ?? "?").padEnd(10)} ${String(s.iterations ?? 0).padStart(10)}  ${s.nextFireAt ?? "-"}`,
        );
      }
    });

  cmd
    .command("status <name>")
    .description("Show state + last-fire details + log tail for a schedule.")
    .option("--tail <n>", "log tail length", "30")
    .action((name: string, opts: { tail: string }) => {
      const cwd = process.cwd();
      const state = readScheduleState(cwd, name);
      if (!state) {
        console.error(kleur.red(`error: no schedule named '${name}' in ${cwd}`));
        process.exit(1);
      }
      console.log(kleur.bold(`schedule: ${state.name}`));
      console.log(`  kind:       ${state.kind}`);
      console.log(`  when:       ${state.when}`);
      console.log(`  status:     ${state.status}`);
      console.log(`  created:    ${state.createdAt}`);
      console.log(`  lastFire:   ${state.lastFireAt ?? "(never)"}`);
      console.log(`  nextFire:   ${state.nextFireAt ?? "-"}`);
      console.log(`  iterations: ${state.iterations}`);
      console.log(`  unit:       ${state.systemdUnit ?? "-"}`);
      console.log(`  log:        ${state.logPath ?? "-"}`);

      if (state.systemdUnit) {
        console.log(kleur.dim("\nsystemctl --user status:"));
        spawnSync(
          "systemctl",
          ["--user", "status", state.systemdUnit.replace(".service", ".timer")],
          { stdio: "inherit" },
        );
      }

      if (state.logPath && existsSync(state.logPath)) {
        console.log(kleur.dim(`\nlog tail (${opts.tail} lines):`));
        spawnSync("tail", ["-n", opts.tail, state.logPath], { stdio: "inherit" });
      }
    });

  cmd
    .command("cancel <name>")
    .description("Stop the systemd timer + remove the state file.")
    .action((name: string) => {
      const cwd = process.cwd();
      const state = readScheduleState(cwd, name);
      if (!state) {
        console.error(kleur.red(`error: no schedule named '${name}' in ${cwd}`));
        process.exit(1);
      }
      const timer = state.systemdUnit?.replace(".service", ".timer");
      if (timer) {
        spawnSync("systemctl", ["--user", "stop", timer], { stdio: "inherit" });
      }
      deleteScheduleState(cwd, name);
      console.log(kleur.green(`  ✓ cancelled ${name}`));
    });

  cmd
    .command("test <name>")
    .description("Re-run dry-fire validation for an existing schedule (without arming).")
    .action((name: string) => {
      const cwd = process.cwd();
      const state = readScheduleState(cwd, name);
      if (!state) {
        console.error(kleur.red(`error: no schedule named '${name}' in ${cwd}`));
        process.exit(1);
      }
      const command = JSON.parse(state.commandJson) as readonly string[];
      const r = dryFire(command, state.cwd);
      if (r.ok) {
        console.log(kleur.green(`  ✓ dry-fire OK`));
        console.log(kleur.dim(`  simulated PATH: ${r.simulatedPath}`));
      } else {
        console.error(kleur.red(`  ✗ dry-fire FAILED (exit ${r.exitCode})`));
        if (r.stderr) console.error(kleur.dim(`  stderr: ${r.stderr.slice(0, 500)}`));
        process.exit(1);
      }
    });

  cmd
    .command("parse-reset <text>")
    .description(
      "INTERNAL: parse a rate-limit reset string ('resets 3pm' or RFC3339) and print the next systemd OnCalendar form. Used by the wrapper script.",
    )
    .option("--safety <seconds>", "safety margin to add after reset", "30")
    .action((text: string, opts: { safety: string }) => {
      const d = parseResetTime(text);
      if (!d) {
        process.exit(1);
      }
      const withMargin = withSafetyMargin(d, Number(opts.safety));
      process.stdout.write(toSystemdCalendar(withMargin));
    });

  cmd
    .command("path")
    .description("Print the full PATH cmax schedule would bake into a unit (debug).")
    .action(() => {
      console.log(discoverFullPath());
    });

  return cmd;
}
