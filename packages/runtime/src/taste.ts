import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@claudemax/core";
import { deepResearch } from "./deepresearch.js";

export interface TasteBootstrapOptions {
  readonly cwd: string;
  readonly currentDateIso?: string;
  readonly singleQuestionFallback?: (q: string) => Promise<string>;
}

export interface TasteBootstrapResult {
  readonly tastePath: string;
  readonly visionPath: string;
  readonly tasteBody: string;
  readonly visionBody: string;
  readonly askedFallbackQuestion: boolean;
}

const TASTE_SYNTHESIS_SYSTEM = (now: string) => `You are the claudemax taste writer. The current date is ${now}.

You will receive: (a) repo signals (README, package manifest, top-level files), (b) a deepresearch brief about SOTA for the detected domain at *current time*, (c) optionally one user clarification.

Produce TWO documents:
- taste.md: operating principles, code style, architecture invariants, testing posture, deps posture. Short, declarative, opinionated. No fluff.
- taste.vision: north star, ICP, success criteria. One short paragraph each.

Output as JSON:
{ "tasteMd": "<full markdown content>", "tasteVision": "<full markdown content>" }

Rules:
- Anchor every architectural choice on the SOTA findings — cite the relevant finding inline.
- If the repo signals contradict SOTA, prefer SOTA and note the migration as a constraint in taste.md.
- No questions for the user. You have everything you need; if you don't, the orchestrator will have asked the one fallback question for you.`;

interface RepoSignals {
  readonly hasReadme: boolean;
  readonly readmeExcerpt: string;
  readonly packageManager: "npm" | "pnpm" | "yarn" | "cargo" | "pip" | "go" | "unknown";
  readonly primaryFrameworks: readonly string[];
  readonly topLevelEntries: readonly string[];
  readonly empty: boolean;
}

function detectRepoSignals(cwd: string): RepoSignals {
  const entries: string[] = [];
  try {
    const { readdirSync } = require("node:fs") as {
      readdirSync(p: string): string[];
    };
    for (const e of readdirSync(cwd)) {
      if (!e.startsWith(".") || e === ".claude") entries.push(e);
    }
  } catch {
    // ignore
  }

  const hasReadme = entries.some((e) => /^readme(\.|$)/i.test(e));
  let readmeExcerpt = "";
  if (hasReadme) {
    const readmeName = entries.find((e) => /^readme(\.|$)/i.test(e))!;
    try {
      readmeExcerpt = readFileSync(join(cwd, readmeName), "utf8").slice(0, 4000);
    } catch {
      // ignore
    }
  }

  let pkgManager: RepoSignals["packageManager"] = "unknown";
  if (existsSync(join(cwd, "pnpm-workspace.yaml")) || existsSync(join(cwd, "pnpm-lock.yaml"))) {
    pkgManager = "pnpm";
  } else if (existsSync(join(cwd, "package-lock.json"))) pkgManager = "npm";
  else if (existsSync(join(cwd, "yarn.lock"))) pkgManager = "yarn";
  else if (existsSync(join(cwd, "Cargo.toml"))) pkgManager = "cargo";
  else if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
    pkgManager = "pip";
  } else if (existsSync(join(cwd, "go.mod"))) pkgManager = "go";

  const frameworks: string[] = [];
  if (existsSync(join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const fw of ["next", "react", "vue", "svelte", "fastify", "hono", "express", "nestjs"]) {
        if (deps[fw]) frameworks.push(fw);
      }
    } catch {
      // ignore
    }
  }

  return {
    hasReadme,
    readmeExcerpt,
    packageManager: pkgManager,
    primaryFrameworks: frameworks,
    topLevelEntries: entries,
    empty: entries.length === 0,
  };
}

export async function autoBootstrapTaste(
  opts: TasteBootstrapOptions,
): Promise<TasteBootstrapResult> {
  const signals = detectRepoSignals(opts.cwd);
  const now = opts.currentDateIso ?? new Date().toISOString();

  let userClarification: string | undefined;
  let askedFallback = false;
  if (signals.empty || (!signals.hasReadme && signals.packageManager === "unknown")) {
    if (opts.singleQuestionFallback) {
      userClarification = await opts.singleQuestionFallback(
        "What are you building, in one sentence?",
      );
      askedFallback = true;
    }
  }

  const researchTopic = buildResearchTopic(signals, userClarification, now);
  const brief = await deepResearch(researchTopic, { cwd: opts.cwd, currentDateIso: now });

  const synthesisInput = {
    repoSignals: {
      packageManager: signals.packageManager,
      frameworks: signals.primaryFrameworks,
      topLevelEntries: signals.topLevelEntries,
      readmeExcerpt: signals.readmeExcerpt,
    },
    researchBrief: brief,
    userClarification,
    currentDate: now,
  };

  let finalResult = "";
  for await (const message of query({
    prompt: `Synthesize taste.md and taste.vision from the following inputs:\n\n${JSON.stringify(synthesisInput, null, 2)}\n\nReturn the JSON object.`,
    options: {
      model: MODELS.opus.id,
      effort: "max",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: TASTE_SYNTHESIS_SYSTEM(now),
      },
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "default",
      maxTurns: 15,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
      outputFormat: {
        type: "json_schema",
        schema: {
          type: "object",
          required: ["tasteMd", "tasteVision"],
          properties: {
            tasteMd: { type: "string" },
            tasteVision: { type: "string" },
          },
        },
      },
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
  if (!jsonMatch) throw new Error(`taste synthesis returned no JSON. Raw:\n${finalResult.slice(0, 500)}`);
  const obj = JSON.parse(jsonMatch[0]) as { tasteMd: string; tasteVision: string };

  const tastePath = join(opts.cwd, "taste.md");
  const visionPath = join(opts.cwd, "taste.vision");
  writeFileSync(tastePath, obj.tasteMd, "utf8");
  writeFileSync(visionPath, obj.tasteVision, "utf8");

  return {
    tastePath,
    visionPath,
    tasteBody: obj.tasteMd,
    visionBody: obj.tasteVision,
    askedFallbackQuestion: askedFallback,
  };
}

function buildResearchTopic(
  signals: RepoSignals,
  clarification: string | undefined,
  now: string,
): string {
  const date = now.slice(0, 7);
  const fws = signals.primaryFrameworks.length
    ? signals.primaryFrameworks.join(", ")
    : signals.packageManager;
  if (clarification) {
    return `SOTA architecture and best practices for ${clarification} as of ${date}. Stack hints: ${fws}.`;
  }
  if (signals.hasReadme) {
    return `SOTA architecture and best practices as of ${date} for the project described in this README excerpt:\n\n${signals.readmeExcerpt.slice(0, 1500)}\n\nStack hints: ${fws}`;
  }
  return `SOTA architecture and best practices as of ${date} for a project using ${fws}`;
}
