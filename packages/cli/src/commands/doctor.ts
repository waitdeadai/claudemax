import { Command } from "commander";
import kleur from "kleur";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { formatPlanBudgetState } from "@claudemax/core";
import { detectPlan, describePlan, computeParallelCap } from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

const HOOK_EVENTS = [
  "Stop",
  "PostToolUse",
  "PreToolUse",
  "UserPromptSubmit",
  "SubagentStop",
  "SessionStart",
  "PreCompact",
  "PostCompact",
  "Notification",
] as const;

type HookEvent = (typeof HOOK_EVENTS)[number];

interface HookHandler {
  type?: string;
  command?: string;
  url?: string;
  timeout?: number;
}

interface HookEntry {
  event: HookEvent;
  matcher: string;
  handler: HookHandler;
  source: string;
}

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Inspect billing mode, plan detection, parallel cap, recent credit consumption")
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--hooks", "list wired Claude Code hooks from user + repo settings.json")
    .option("--strict", "with --hooks, exit non-zero if any wired hook is misconfigured")
    .action((opts: { memory: string; hooks?: boolean; strict?: boolean }) => {
      if (opts.hooks) {
        const code = runHooksReport({ strict: opts.strict === true });
        process.exit(code);
        return;
      }

      const info = detectPlan();
      console.log(kleur.bold("billing"));
      console.log(`  plan:        ${planColor(info.plan)}`);
      console.log(`  billing:     ${info.billing}`);
      console.log(
        `  era:         ${
          info.era === "pre-split"
            ? kleur.yellow("pre-split (today; cmax ask shares your subscription 5h rolling pool until 2026-06-15)")
            : kleur.green("post-split (Agent SDK credit pool active)")
        }`,
      );
      console.log(`  credit:      ${info.monthlyCreditUsd != null ? `$${info.monthlyCreditUsd}/mo${info.era === "pre-split" ? kleur.dim(" (forward-compat only)") : ""}` : "(api — pay-per-token)"}`);
      console.log(`  source:      ${info.source}`);
      console.log(kleur.dim(`  ${describePlan(info)}`));
      if (info.era === "pre-split") {
        console.log(
          kleur.dim(
            "  override era for dry-run: CMAX_BILLING_ERA=post-split  (or via: cmax config set billingEra post-split)",
          ),
        );
      }

      let consumed = 0;
      try {
        const m = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
        consumed = m.creditConsumedThisPeriod();
        m.close();
      } catch (e) {
        console.log(kleur.dim(`  (no memory yet: ${(e as Error).message})`));
      }

      console.log(kleur.bold("\nbudget"));
      console.log(`  ${formatPlanBudgetState(info.plan, consumed)}`);

      const cap = computeParallelCap({
        plan: info.plan,
        remainingCreditUsd:
          info.monthlyCreditUsd != null ? Math.max(0, info.monthlyCreditUsd - consumed) : undefined,
        perPacketCostEstimateUsd: 0.4,
      });
      console.log(kleur.bold("\nparallel cap"));
      console.log(`  hardware:    ${cap.hardware}`);
      if (cap.creditAware != null) console.log(`  credit:      ${cap.creditAware}`);
      console.log(`  effective:   ${kleur.cyan(String(cap.effective))}`);
      console.log(kleur.dim(`  ${cap.reason}`));

      console.log(kleur.bold("\nauth surface"));
      console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? kleur.green("set") : kleur.gray("unset (subscription path active)")}`);
      console.log(`  CMAX_PLAN env:     ${process.env.CMAX_PLAN ?? kleur.gray("unset")}`);

      const versionCheck = checkManifestVersions(process.cwd());
      console.log(kleur.bold("\nmanifest versions"));
      if (versionCheck.ok) {
        console.log(`  ${kleur.green("OK")}  package.json + plugin.json both at ${versionCheck.pkg}`);
      } else {
        console.log(
          `  ${kleur.red("ERROR")} version mismatch — package.json=${versionCheck.pkg ?? "?"} plugin.json=${versionCheck.plugin ?? "?"}`,
        );
        console.log(kleur.dim("  fix with: scripts/bump-version.sh <semver>"));
        process.exit(1);
      }
    });
}

function runHooksReport(opts: { strict: boolean }): number {
  const entries = readHookEntries({
    userPath: join(homedir(), ".claude", "settings.json"),
    repoPath: join(process.cwd(), ".claude", "settings.json"),
  });
  console.log(kleur.bold("wired hooks"));
  if (entries.length === 0) {
    console.log(kleur.dim("  (no hooks found in ~/.claude/settings.json or .claude/settings.json)"));
  } else {
    let lastSource: string | null = null;
    for (const e of entries) {
      if (e.source !== lastSource) {
        console.log(kleur.dim(`  source: ${e.source}`));
        lastSource = e.source;
      }
      const cmd =
        typeof e.handler.command === "string"
          ? e.handler.command
          : typeof e.handler.url === "string"
            ? e.handler.url
            : "(no command/url)";
      console.log(`    ${kleur.cyan(e.event)}  matcher=${e.matcher}  ${kleur.dim(cmd)}`);
    }
  }

  console.log(kleur.bold("\nagentcloseout-physics"));
  const probe = probeAgentcloseoutPhysics();
  if (probe.path) {
    console.log(`  path:    ${probe.path}`);
    console.log(`  version: ${probe.version ?? kleur.yellow("(unknown)")}`);
  } else {
    console.log(kleur.yellow("  not found on PATH (hooks will fall back to regex scoring)"));
  }

  const misconfigured = entries
    .map((e) => ({ entry: e, reason: detectMisconfiguredHook(e.handler) }))
    .filter((r): r is { entry: HookEntry; reason: string } => r.reason !== null);
  if (misconfigured.length > 0) {
    console.log(kleur.bold("\nmisconfigured hooks"));
    for (const m of misconfigured) {
      console.log(`  ${kleur.red("ERROR")} ${m.entry.event} (${m.entry.source}): ${m.reason}`);
    }
    if (opts.strict) return 1;
  }
  return 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readHookEntries(paths: { userPath: string; repoPath: string }): HookEntry[] {
  const out: HookEntry[] = [];
  for (const source of [paths.userPath, paths.repoPath]) {
    if (!existsSync(source)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(source, "utf8"));
    } catch {
      continue;
    }
    if (!isObject(parsed)) continue;
    const hooks = parsed["hooks"];
    if (!isObject(hooks)) continue;
    for (const event of HOOK_EVENTS) {
      const blocks = hooks[event];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!isObject(block)) continue;
        const matcher =
          typeof block["matcher"] === "string" && (block["matcher"] as string).length > 0
            ? (block["matcher"] as string)
            : "*";
        const handlers = block["hooks"];
        if (!Array.isArray(handlers)) continue;
        for (const h of handlers) {
          if (!isObject(h)) continue;
          const handler: HookHandler = {};
          if (typeof h["type"] === "string") handler.type = h["type"];
          if (typeof h["command"] === "string") handler.command = h["command"];
          if (typeof h["url"] === "string") handler.url = h["url"];
          if (typeof h["timeout"] === "number") handler.timeout = h["timeout"];
          out.push({ event, matcher, handler, source });
        }
      }
    }
  }
  return out;
}

function detectMisconfiguredHook(h: HookHandler): string | null {
  if (typeof h.type !== "string" || h.type.length === 0) return "missing type (expected 'command' or 'http')";
  if (h.type === "command") {
    if (typeof h.command !== "string" || h.command.length === 0) return "type=command requires a non-empty command";
    return null;
  }
  if (h.type === "http") {
    if (typeof h.url !== "string" || h.url.length === 0) return "type=http requires a non-empty url";
    return null;
  }
  return `unknown type: ${h.type}`;
}

function probeAgentcloseoutPhysics(): { path: string | null; version: string | null } {
  let path: string | null = null;
  let version: string | null = null;
  try {
    const out = execFileSync("which", ["agentcloseout-physics"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length > 0) path = out;
  } catch {
    path = null;
  }
  if (path) {
    try {
      version = execFileSync(path, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      version = null;
    }
  }
  return { path, version };
}

interface VersionCheck {
  ok: boolean;
  pkg: string | null;
  plugin: string | null;
}

function checkManifestVersions(cwd: string): VersionCheck {
  const pkg = readVersion(resolve(cwd, "package.json"));
  const plugin = readVersion(resolve(cwd, "plugin.json"));
  return { ok: pkg !== null && pkg === plugin, pkg, plugin };
}

function readVersion(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function planColor(plan: string): string {
  if (plan === "max20x") return kleur.magenta(plan);
  if (plan === "max5x") return kleur.blue(plan);
  if (plan === "pro") return kleur.cyan(plan);
  return kleur.gray(plan);
}
