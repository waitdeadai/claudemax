import { Command } from "commander";
import kleur from "kleur";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CONFIG_PATH = ".claudemax/config.json";

interface Config {
  plan?: string;
  defaultVariant?: string;
  defaultMode?: string;
  costCeilingUsd?: number;
  maxParallel?: number;
}

function loadConfig(cwd: string): Config {
  const p = resolve(cwd, CONFIG_PATH);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Config;
  } catch {
    return {};
  }
}

function saveConfig(cwd: string, cfg: Config): void {
  const p = resolve(cwd, CONFIG_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
}

export function configCommand(): Command {
  const cmd = new Command("config").description("Get/set/list claudemax project config");

  cmd
    .command("list")
    .description("Print the current config")
    .action(() => {
      const cfg = loadConfig(process.cwd());
      console.log(JSON.stringify(cfg, null, 2));
    });

  cmd
    .command("get <key>")
    .description("Print a single config key")
    .action((key: string) => {
      const cfg = loadConfig(process.cwd()) as Record<string, unknown>;
      const val = cfg[key];
      if (val === undefined) {
        console.log(kleur.dim(`${key} (unset)`));
        process.exit(1);
      }
      console.log(val);
    });

  cmd
    .command("set <key> <value>")
    .description("Set a config key (writes .claudemax/config.json)")
    .action((key: string, value: string) => {
      const cfg = loadConfig(process.cwd()) as Record<string, unknown>;
      const parsed: unknown = /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      cfg[key] = parsed;
      saveConfig(process.cwd(), cfg);
      console.log(kleur.green(`✓ set ${key} = ${JSON.stringify(parsed)}`));
    });

  cmd
    .command("path")
    .description("Print the config file path")
    .action(() => {
      console.log(join(process.cwd(), CONFIG_PATH));
    });

  return cmd;
}
