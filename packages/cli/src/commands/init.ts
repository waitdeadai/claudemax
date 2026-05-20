import { Command } from "commander";
import kleur from "kleur";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPlan } from "@claudemax/runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SKILLS_DIR = resolve(REPO_ROOT, "skills");
const HOOKS_DIR = resolve(REPO_ROOT, ".claude", "hooks");
const VENDOR_DP_DIR = resolve(REPO_ROOT, "vendor", "llm-dark-patterns");

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === ".git") continue;
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

interface DpHooksJson {
  hooks: Record<string, unknown[]>;
}

function loadDarkPatternsHookEntries(): DpHooksJson | null {
  const p = join(VENDOR_DP_DIR, "hooks", "hooks.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DpHooksJson;
  } catch {
    return null;
  }
}

function rewriteHookCommandsToDpWrapper(entries: DpHooksJson): DpHooksJson {
  const out: DpHooksJson = { hooks: {} };
  for (const [event, blocks] of Object.entries(entries.hooks)) {
    out.hooks[event] = (blocks as Array<Record<string, unknown>>).map((block) => {
      const newBlock = { ...block };
      const innerHooks = block["hooks"] as Array<{ type: string; command: string; timeout?: number }> | undefined;
      if (innerHooks) {
        newBlock["hooks"] = innerHooks.map((h) => {
          // Replace `bash "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh"` with `bash .claude/hooks/dp.sh <name>.sh`
          const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([\w.-]+)/.exec(h.command);
          const name = m?.[1];
          return {
            ...h,
            command: name ? `bash .claude/hooks/dp.sh ${name}` : h.command,
          };
        });
      }
      return newBlock;
    });
  }
  return out;
}

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  env?: Record<string, string>;
  permissions?: { allow?: string[] };
  [k: string]: unknown;
}

function mergeHookEntries(
  existing: ClaudeSettings,
  cmaxHooks: Record<string, unknown[]>,
  dpHooks: Record<string, unknown[]>,
): ClaudeSettings {
  const out: ClaudeSettings = { ...existing };
  out.hooks = { ...(existing.hooks ?? {}) };
  for (const [event, blocks] of Object.entries(cmaxHooks)) {
    out.hooks[event] = [...((out.hooks[event] as unknown[]) ?? []), ...blocks];
  }
  for (const [event, blocks] of Object.entries(dpHooks)) {
    out.hooks[event] = [...((out.hooks[event] as unknown[]) ?? []), ...blocks];
  }
  return out;
}

function defaultCmaxHookEntries(): Record<string, unknown[]> {
  return {
    SessionStart: [
      { matcher: ".*", hooks: [{ type: "command", command: ".claude/hooks/cmax-session-start.sh" }] },
    ],
    Stop: [
      { matcher: ".*", hooks: [{ type: "command", command: ".claude/hooks/cmax-stop.sh" }] },
    ],
    PostToolUse: [
      { matcher: "Edit|Write", hooks: [{ type: "command", command: ".claude/hooks/cmax-post-tool-use.sh" }] },
    ],
  };
}

export function initCommand(): Command {
  return new Command("init")
    .description("Install the claudemax skill bundle + hooks + bundled llm-dark-patterns into a project")
    .option("--target <path>", "target project root", ".")
    .option("--force", "overwrite existing skill / settings files", false)
    .option("--no-dark-patterns", "skip the bundled llm-dark-patterns hooks")
    .action((opts: { target: string; force: boolean; darkPatterns: boolean }) => {
      const target = resolve(process.cwd(), opts.target);
      const dstSkills = join(target, ".claude", "skills");
      const dstHooks = join(target, ".claude", "hooks");
      const dstSettings = join(target, ".claude", "settings.json");

      if (existsSync(dstSkills) && !opts.force) {
        console.log(kleur.yellow(`! ${dstSkills} exists. Use --force to overwrite.`));
        return;
      }
      if (!existsSync(SKILLS_DIR)) {
        console.log(kleur.red(`! could not find skills source at ${SKILLS_DIR}`));
        return;
      }

      copyDir(SKILLS_DIR, dstSkills);
      console.log(kleur.green(`+ skills → ${dstSkills}`));

      if (existsSync(HOOKS_DIR)) {
        copyDir(HOOKS_DIR, dstHooks);
        console.log(kleur.green(`+ claudemax hooks → ${dstHooks}`));
      }

      // Bundle llm-dark-patterns (vendored sibling repo)
      let dpHooks: Record<string, unknown[]> = {};
      if (opts.darkPatterns !== false) {
        if (existsSync(VENDOR_DP_DIR)) {
          const dstDp = join(dstHooks, "dark-patterns");
          copyDir(VENDOR_DP_DIR, dstDp);
          console.log(kleur.green(`+ llm-dark-patterns (bundled) → ${dstDp}`));
          const raw = loadDarkPatternsHookEntries();
          if (raw) {
            dpHooks = rewriteHookCommandsToDpWrapper(raw).hooks;
            console.log(kleur.dim(`  ${Object.keys(dpHooks).length} hook events wired`));
          }
        } else {
          console.log(
            kleur.yellow(
              `! vendor/llm-dark-patterns/ not found at ${VENDOR_DP_DIR}\n  Run \`pnpm dark-patterns:sync\` from the claudemax install dir to fetch it,\n  then re-run \`cmax init --force\`. Or pass \`--no-dark-patterns\` to skip.`,
            ),
          );
        }
      }

      const cmaxHooks = defaultCmaxHookEntries();
      let existingSettings: ClaudeSettings = {};
      if (existsSync(dstSettings) && !opts.force) {
        try {
          existingSettings = JSON.parse(readFileSync(dstSettings, "utf8")) as ClaudeSettings;
        } catch {
          // ignore parse errors; will overwrite-by-merge
        }
      }
      const merged = mergeHookEntries(existingSettings, cmaxHooks, dpHooks);
      merged.env = { ...(existingSettings.env ?? {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "true" };
      writeFileSync(dstSettings, JSON.stringify(merged, null, 2), "utf8");
      console.log(kleur.green(`+ settings.json → ${dstSettings}`));

      const stateDir = join(target, ".claudemax");
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

      const info = detectPlan();
      writeFileSync(
        join(stateDir, "plan-detection.json"),
        JSON.stringify(
          {
            plan: info.plan,
            billing: info.billing,
            monthlyCreditUsd: info.monthlyCreditUsd,
            source: info.source,
            detectedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(
        kleur.cyan(
          `→ plan auto-detected: ${info.plan} (${info.billing}, ${info.monthlyCreditUsd ?? "n/a"}/mo, ${info.source})`,
        ),
      );

      console.log(
        kleur.dim(
          "\n  Slash commands available: /cmax /workflow /opussonnet /opusolo /spec /goal /verify /deepresearch /audit /investigate /codesearch /introspect /specqa /parallel /hive /council /review /ship /align /overnight /taste /deepretaste /agentfactory /agentteams /route /memory",
        ),
      );
      if (Object.keys(dpHooks).length > 0) {
        console.log(
          kleur.dim(
            "  Dark-patterns hooks active: no-vibes, no-emoji-spam, no-aggregator-hallucination, honest-eta, no-credential-leak-in-handoff, ... (full set from waitdeadai/llm-dark-patterns, bundled).",
          ),
        );
      }
    });
}
