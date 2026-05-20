import { Command } from "commander";
import kleur from "kleur";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

interface CmaxConfig {
  ntfyTopic?: string;
  ntfyServer?: string;
  installedAt?: string;
  installDir?: string;
}

function which(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function tailscaleHostname(): string | null {
  try {
    const out = execSync("tailscale status --json 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const j = JSON.parse(out) as { Self?: { DNSName?: string; HostName?: string } };
    return j.Self?.DNSName?.replace(/\.$/, "") ?? j.Self?.HostName ?? null;
  } catch {
    return null;
  }
}

function globalConfigPath(): string {
  return join(homedir(), ".claudemax-state", "config.json");
}

function loadGlobalConfig(): CmaxConfig {
  const p = globalConfigPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CmaxConfig;
  } catch {
    return {};
  }
}

function saveGlobalConfig(cfg: CmaxConfig): void {
  const p = globalConfigPath();
  mkdirSync(join(homedir(), ".claudemax-state"), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
}

function ensureNtfyTopic(): string {
  const env = process.env["NTFY_TOPIC"];
  if (env) return env;
  const cfg = loadGlobalConfig();
  if (cfg.ntfyTopic) return cfg.ntfyTopic;
  const user = process.env["USER"] ?? "user";
  const suffix = Math.random().toString(36).slice(2, 12);
  const topic = `cmax-${user}-${suffix}`;
  saveGlobalConfig({ ...cfg, ntfyTopic: topic, ntfyServer: cfg.ntfyServer ?? "https://ntfy.sh" });
  return topic;
}

function tryQrencode(target: string): string | null {
  const r = spawnSync("qrencode", ["-t", "UTF8", "-m", "1", target], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

export function bgCommand(): Command {
  const cmd = new Command("bg").description(
    "Background / remote orchestration helpers (tmux + Tailscale + ntfy + phone onboarding)",
  );

  cmd
    .command("setup")
    .description("Create a tmux session 'claudemax' with one window per project")
    .option(
      "--projects <paths>",
      "comma-separated absolute paths to project roots (default: current dir)",
      "",
    )
    .option("--session <name>", "tmux session name", "claudemax")
    .option(
      "--start <cmd>",
      "command to run in each project window after cd (e.g., 'cmax doctor')",
      "",
    )
    .action((opts: { projects: string; session: string; start: string }) => {
      if (!which("tmux")) {
        console.log(kleur.red("! tmux not found. Install tmux first (apt install tmux / brew install tmux)."));
        process.exit(1);
      }
      let projects = opts.projects
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => resolve(process.cwd(), p));
      if (projects.length === 0) {
        projects = [process.cwd()];
        console.log(kleur.dim(`(no --projects; defaulting to current dir: ${projects[0]})`));
      }
      for (const p of projects) {
        if (!existsSync(p)) {
          console.log(kleur.red(`! project path does not exist: ${p}`));
          process.exit(1);
        }
      }

      const session = opts.session;
      if (tmuxSessionExists(session)) {
        console.log(kleur.yellow(`! tmux session '${session}' already exists. Reuse it or kill with: tmux kill-session -t ${session}`));
        process.exit(1);
      }

      const first = projects[0]!;
      const firstName = basename(first);
      execSync(`tmux new-session -d -s ${session} -n ${firstName} -c ${shellEscape(first)}`);
      console.log(kleur.green(`+ tmux window 0: ${firstName} (${first})`));
      if (opts.start) execSync(`tmux send-keys -t ${session}:0 ${shellEscape(opts.start)} C-m`);

      for (let i = 1; i < projects.length; i++) {
        const p = projects[i]!;
        const name = basename(p);
        execSync(`tmux new-window -t ${session} -n ${name} -c ${shellEscape(p)}`);
        console.log(kleur.green(`+ tmux window ${i}: ${name} (${p})`));
        if (opts.start) execSync(`tmux send-keys -t ${session}:${i} ${shellEscape(opts.start)} C-m`);
      }

      console.log(kleur.bold(`\n→ session '${session}' created with ${projects.length} window(s).`));
      console.log(kleur.dim(`  attach locally:   tmux a -t ${session}`));

      const ts = tailscaleHostname();
      if (ts) {
        const user = process.env["USER"] ?? "user";
        console.log(kleur.dim("  attach from phone (Termius/Termux over Tailscale):"));
        console.log(kleur.cyan(`    ssh ${user}@${ts} -t "tmux a -t ${session}"`));
      } else {
        console.log(kleur.dim("  (install Tailscale on PC + phone for remote SSH attach — see docs/REMOTE_OPERATION.md)"));
      }
    });

  cmd
    .command("kill")
    .description("Kill a tmux session created by `cmax bg setup`")
    .option("--session <name>", "tmux session name", "claudemax")
    .action((opts: { session: string }) => {
      if (!tmuxSessionExists(opts.session)) {
        console.log(kleur.yellow(`! no session named '${opts.session}'`));
        return;
      }
      execSync(`tmux kill-session -t ${opts.session}`);
      console.log(kleur.green(`✓ killed tmux session '${opts.session}'`));
    });

  cmd
    .command("status")
    .description("Show remote / background prerequisites: tmux, Tailscale, ntfy, claude")
    .action(() => {
      const cfg = loadGlobalConfig();
      const ntfyTopic = process.env["NTFY_TOPIC"] ?? cfg.ntfyTopic ?? null;
      const ntfySource = process.env["NTFY_TOPIC"] ? "env" : cfg.ntfyTopic ? "config" : null;
      const checks: Array<{ name: string; ok: boolean; hint: string }> = [];
      checks.push({
        name: "tmux installed",
        ok: which("tmux"),
        hint: "apt install tmux  /  brew install tmux",
      });
      checks.push({
        name: "tailscale installed",
        ok: which("tailscale"),
        hint: "curl -fsSL https://tailscale.com/install.sh | sh",
      });
      const ts = tailscaleHostname();
      checks.push({
        name: "tailscale up + hostname known",
        ok: ts !== null,
        hint: ts ? `hostname: ${ts}` : "sudo tailscale up",
      });
      checks.push({
        name: "qrencode installed (for cmax bg phone)",
        ok: which("qrencode"),
        hint: "apt install qrencode / brew install qrencode (optional)",
      });
      checks.push({
        name: "curl installed (for ntfy push)",
        ok: which("curl"),
        hint: "apt install curl",
      });
      checks.push({
        name: "NTFY_TOPIC available (env or config)",
        ok: ntfyTopic !== null,
        hint: ntfyTopic
          ? `${ntfyTopic} (source: ${ntfySource})`
          : "run `cmax bg phone` to auto-generate + write to config",
      });
      checks.push({
        name: "claude CLI on PATH",
        ok: which("claude"),
        hint: "needed for Mode B (Agent Teams) subprocess; install Claude Code",
      });

      for (const c of checks) {
        const sym = c.ok ? kleur.green("ok ") : kleur.yellow("-- ");
        console.log(`${sym} ${c.name.padEnd(40)} ${kleur.dim(c.hint)}`);
      }
      const tsHost = tailscaleHostname();
      if (tsHost) {
        const user = process.env["USER"] ?? "user";
        console.log(kleur.bold("\nremote attach command:"));
        console.log(kleur.cyan(`  ssh ${user}@${tsHost} -t "tmux a -t claudemax"`));
      }
    });

  cmd
    .command("phone")
    .description("Print phone-side onboarding (ntfy QR + Tailscale + SSH-client install + remote ssh command)")
    .option("--regenerate-topic", "generate a fresh NTFY_TOPIC (overwrites config)", false)
    .action((opts: { regenerateTopic: boolean }) => {
      let topic: string;
      if (opts.regenerateTopic) {
        const cfg = loadGlobalConfig();
        const user = process.env["USER"] ?? "user";
        const suffix = Math.random().toString(36).slice(2, 12);
        topic = `cmax-${user}-${suffix}`;
        saveGlobalConfig({ ...cfg, ntfyTopic: topic, ntfyServer: cfg.ntfyServer ?? "https://ntfy.sh" });
        console.log(kleur.cyan(`→ regenerated NTFY_TOPIC=${topic} (written to ${globalConfigPath()})`));
      } else {
        topic = ensureNtfyTopic();
      }
      const ntfyDeep = `ntfy://ntfy.sh/${topic}`;
      const ntfyWeb = `https://ntfy.sh/${topic}`;

      const printQr = (target: string, label: string): void => {
        console.log(kleur.bold(`\n${label}`));
        const out = tryQrencode(target);
        if (out) console.log(out);
        else console.log(kleur.dim("  (install qrencode for inline QR codes: apt install qrencode)"));
        console.log(kleur.cyan(`  ${target}`));
      };

      console.log(kleur.bold("=== phone-side onboarding for claudemax ==="));
      console.log(kleur.dim(`  NTFY_TOPIC: ${topic}`));
      console.log(kleur.dim(`  Add to shell: export NTFY_TOPIC=${topic}`));

      printQr(ntfyDeep, "1. Install ntfy app and subscribe to your topic (deep link)");
      console.log(kleur.dim(`   web fallback: ${ntfyWeb}`));

      printQr("https://tailscale.com/download", "2. Install Tailscale app, sign in with same account as PC");

      printQr("https://itunes.apple.com/app/id549039908", "3a. iOS: install Termius (or Blink Shell)");
      printQr("https://play.google.com/store/apps/details?id=com.termux", "3b. Android: install Termux (or Termius)");

      const ts = tailscaleHostname();
      if (ts) {
        const user = process.env["USER"] ?? "user";
        console.log(kleur.bold("\n4. Attach from phone after running `cmax bg setup --projects ...`"));
        console.log(kleur.cyan(`   ssh ${user}@${ts} -t "tmux a -t claudemax"`));
      } else {
        console.log(kleur.yellow("\n4. (Tailscale not authenticated yet — run `sudo tailscale up` then re-run `cmax bg phone`.)"));
      }

      console.log(kleur.dim("\n  Push notifications: every claudemax run completion sends to your phone via ntfy."));
      console.log(kleur.dim("  See docs/REMOTE_OPERATION.md for the full stack."));
    });

  return cmd;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
