import { Command } from "commander";
import kleur from "kleur";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

interface CmaxConfig {
  installDir?: string;
}

function detectInstallDir(): string | null {
  // 1. Global config from setup.sh
  const cfgPath = join(homedir(), ".claudemax-state", "config.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as CmaxConfig;
      if (cfg.installDir && existsSync(join(cfg.installDir, ".git"))) return cfg.installDir;
    } catch {
      // ignore
    }
  }
  // 2. Walk up from this binary's location until we find a .git
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let cur = resolve(__dirname, "..", "..", "..", "..");
    if (existsSync(join(cur, ".git"))) return cur;
  } catch {
    // ignore
  }
  // 3. Default convention
  const def = join(homedir(), ".claudemax");
  if (existsSync(join(def, ".git"))) return def;
  return null;
}

function run(cmd: string, cwd: string): void {
  console.log(kleur.dim(`  $ ${cmd}`));
  execSync(cmd, { cwd, stdio: "inherit" });
}

export function updateCommand(): Command {
  return new Command("update")
    .description("Update claudemax in place: git pull + pnpm install + pnpm build, then cmax doctor")
    .option("--install-dir <path>", "override install directory (default: auto-detect)")
    .option("--no-doctor", "skip the post-update cmax doctor run")
    .option("--dry-run", "print what would run without executing", false)
    .action((opts: { installDir?: string; doctor: boolean; dryRun: boolean }) => {
      const installDir = opts.installDir
        ? resolve(opts.installDir)
        : detectInstallDir();
      if (!installDir) {
        console.log(
          kleur.red(
            "! could not auto-detect claudemax install dir.\n  Pass --install-dir <path> explicitly. Looked in:\n  - ~/.claudemax-state/config.json (installDir field)\n  - this binary's location walked up to a .git\n  - ~/.claudemax",
          ),
        );
        process.exit(1);
      }
      if (!existsSync(join(installDir, ".git"))) {
        console.log(kleur.red(`! ${installDir} is not a git repo. Cannot git pull.`));
        process.exit(1);
      }

      console.log(kleur.bold(`→ updating claudemax at ${installDir}`));

      const commands = [
        `git -C ${shellEscape(installDir)} fetch --quiet origin`,
        `git -C ${shellEscape(installDir)} pull --ff-only`,
        `pnpm install --silent`,
        `pnpm build`,
      ];

      if (opts.dryRun) {
        console.log(kleur.yellow("dry-run — would execute:"));
        for (const c of commands) console.log(`  ${c}`);
        return;
      }

      try {
        run(commands[0]!, installDir);
        run(commands[1]!, installDir);
        run("pnpm install", installDir);
        run("pnpm build", installDir);
      } catch (err) {
        console.log(kleur.red(`! update failed: ${(err as Error).message}`));
        process.exit(1);
      }

      console.log(kleur.green("\n✓ update complete"));

      if (opts.doctor !== false) {
        console.log(kleur.bold("\n→ cmax doctor"));
        try {
          execSync("node packages/cli/dist/index.js doctor", { cwd: installDir, stdio: "inherit" });
        } catch {
          // doctor failures shouldn't fail the update
        }
      }
    });
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
