import { Command } from "commander";
import kleur from "kleur";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Wraps `ecc-agentshield` (github.com/affaan-m/agentshield, MIT) as an EXTERNAL
// CLI via npx — deliberately NOT a claudemax dependency. agentshield pulls the
// bare `@anthropic-ai/sdk`, which the anthropic-only invariant forbids INSIDE this
// repo (rule: only @anthropic-ai/claude-agent-sdk). Running it out-of-process keeps
// that dependency in agentshield's own tree, never ours. The default scan is
// STATIC + read-only (no Opus, no network, no --fix). See
// vault/decisions/agentshield-wrap.md.
export function securityScanCommand(): Command {
  return new Command("security-scan")
    .description(
      "Audit a Claude Code config dir for security issues (hardcoded secrets, over-broad permissions, hook injection, MCP risks, prompt-injection vectors) via ecc-agentshield. Static + read-only by default.",
    )
    .argument("[path]", "config dir to scan", ".claude")
    .option("--min-severity <sev>", "critical | high | medium | low | info", "high")
    .option("--format <fmt>", "terminal | json | markdown | html", "terminal")
    .option("--gate", "exit non-zero on new critical/high (pair with --baseline for CI)", false)
    .option("--baseline <path>", "compare against a saved baseline and report regressions")
    .option("--fix", "auto-apply safe fixes — WRITES files; off by default", false)
    .option("--opus", "opt into agentshield's Opus deep analysis (uses the Anthropic API; off by default)", false)
    .action(
      (
        path: string,
        opts: {
          minSeverity: string;
          format: string;
          gate: boolean;
          baseline?: string;
          fix: boolean;
          opus: boolean;
        },
      ) => {
        const target = resolve(process.cwd(), path);
        const args = [
          "-y",
          "ecc-agentshield@latest",
          "scan",
          "--path",
          target,
          "--min-severity",
          opts.minSeverity,
          "--format",
          opts.format,
        ];
        if (opts.gate) args.push("--gate");
        if (opts.baseline) args.push("--baseline", resolve(process.cwd(), opts.baseline));
        if (opts.fix) args.push("--fix");
        if (opts.opus) args.push("--opus");

        console.log(
          kleur.cyan(
            `→ agentshield scan ${target}  (min-severity=${opts.minSeverity}${opts.gate ? ", gate" : ""}${opts.fix ? ", FIX" : ""}${opts.opus ? ", opus" : ""})`,
          ),
        );
        console.log(
          kleur.dim(
            "  ecc-agentshield runs externally via npx — not a claudemax dependency (preserves the @anthropic-ai/sdk-free invariant).",
          ),
        );

        const r = spawnSync("npx", args, { cwd: process.cwd(), stdio: "inherit", env: process.env });
        if (r.error) {
          console.error(kleur.red(`agentshield could not run: ${r.error.message}`));
          console.error(
            kleur.dim(
              "  the first npx fetch needs network; or `npm i -g ecc-agentshield` once, then re-run offline.",
            ),
          );
          process.exit(2);
        }
        process.exit(r.status ?? 0);
      },
    );
}
