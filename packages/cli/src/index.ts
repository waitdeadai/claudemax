#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { specCommand } from "./commands/spec.js";
import { routeCommand } from "./commands/route.js";
import { goalCommand } from "./commands/goal.js";
import { verifyCommand } from "./commands/verify.js";
import { runCommand } from "./commands/run.js";
import { memoryCommand } from "./commands/memory.js";
import { initCommand } from "./commands/init.js";
import { dispatchCommand } from "./commands/dispatch.js";
import { doctorCommand } from "./commands/doctor.js";
import { tasteCommand } from "./commands/taste.js";
import { overnightCommand } from "./commands/overnight.js";
import { researchCommand } from "./commands/research.js";
import { configCommand } from "./commands/config.js";
import { bgCommand } from "./commands/bg.js";
import { updateCommand } from "./commands/update.js";
import { askCommand } from "./commands/ask.js";
import { tddCommand } from "./commands/tdd.js";

const program = new Command();

program
  .name("cmax")
  .description(kleur.bold("claudemax") + " — Anthropic-native power-user harness")
  .version("0.2.0");

program.addCommand(askCommand());
program.addCommand(runCommand());
program.addCommand(doctorCommand());
program.addCommand(tasteCommand());
program.addCommand(overnightCommand());
program.addCommand(researchCommand());
program.addCommand(specCommand());
program.addCommand(routeCommand());
program.addCommand(goalCommand());
program.addCommand(verifyCommand());
program.addCommand(tddCommand());
program.addCommand(dispatchCommand());
program.addCommand(memoryCommand());
program.addCommand(configCommand());
program.addCommand(bgCommand());
program.addCommand(updateCommand());
program.addCommand(initCommand());

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(kleur.red("error:"), err.message);
  process.exit(1);
});
