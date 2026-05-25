import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { renderSpecMarkdown, type ModelId, type MultiSpec, type Spec } from "@claudemax/core";

export interface AgentTeamsRunOptions {
  readonly cwd: string;
  readonly stateDir?: string;
  readonly maxParallel?: number;
  /** Executor model for each teammate (passed as `claude --model`). Defaults to the CLI default. */
  readonly model?: ModelId;
  readonly onTeammateStart?: (subSpecId: string) => void;
  readonly onTeammateEnd?: (subSpecId: string, status: "finished" | "blocked" | "failed") => void;
  readonly _spawnTeammate?: (opts: SpawnTeammateOptions) => Promise<"finished" | "blocked" | "failed">;
}

export interface AgentTeamsRunResult {
  readonly perSubSpec: Readonly<Record<string, "finished" | "blocked" | "failed">>;
  readonly sharedTaskListPath: string;
  readonly worktreeDir: string;
  readonly agentViewCommand: string;
}

export interface SpawnTeammateOptions {
  readonly cwd: string;
  readonly stateDir: string;
  readonly subSpecId: string;
  readonly sharedTaskListPath: string;
  readonly model?: ModelId;
}

export async function runAgentTeams(
  multispec: MultiSpec,
  opts: AgentTeamsRunOptions,
): Promise<AgentTeamsRunResult> {
  const stateDir = opts.stateDir ?? join(opts.cwd, ".claudemax", "state", `agent-teams-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });

  const sharedTaskListPath = join(stateDir, "shared-task-list.md");
  writeFileSync(sharedTaskListPath, renderSharedTaskList(multispec), "utf8");

  for (const subSpec of multispec.subSpecs) {
    const subSpecPath = join(stateDir, `${subSpecIdOf(subSpec)}.SPEC.md`);
    writeFileSync(subSpecPath, renderSpecMarkdown(subSpec), "utf8");
  }

  const worktreeDir = join(opts.cwd, ".claude", "worktrees");
  const agentViewCommand = `cd ${opts.cwd} && claude --agent-view  # or press Ctrl+a in claude session`;

  const perSubSpec: Record<string, "finished" | "blocked" | "failed"> = {};

  const maxParallel = resolveMaxParallel(opts.maxParallel, multispec.subSpecs.length);
  const spawnImpl = opts._spawnTeammate ?? spawnTeammate;

  const remaining = new Map<string, Spec>();
  const dependencies = new Map<string, Set<string>>();
  for (const s of multispec.subSpecs) {
    const id = subSpecIdOf(s);
    remaining.set(id, s);
    dependencies.set(id, new Set());
  }
  for (const dep of multispec.dependencies) {
    if (dependencies.has(dep.from) && remaining.has(dep.to)) {
      dependencies.get(dep.from)!.add(dep.to);
    }
  }

  const active = new Set<Promise<void>>();

  while (remaining.size > 0 || active.size > 0) {
    while (active.size < maxParallel) {
      const next = pickReady(remaining, dependencies);
      if (!next) break;
      const id = subSpecIdOf(next);
      remaining.delete(id);
      opts.onTeammateStart?.(id);
      const p = spawnImpl({
        cwd: opts.cwd,
        stateDir,
        subSpecId: id,
        sharedTaskListPath,
        model: opts.model,
      })
        .then((status) => {
          perSubSpec[id] = status;
          opts.onTeammateEnd?.(id, status);
          for (const deps of dependencies.values()) deps.delete(id);
        })
        .finally(() => {
          active.delete(p);
        });
      active.add(p);
    }

    if (active.size === 0 && remaining.size > 0) {
      for (const [id] of remaining) {
        perSubSpec[id] = "failed";
        opts.onTeammateEnd?.(id, "failed");
      }
      remaining.clear();
      break;
    }

    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  return { perSubSpec, sharedTaskListPath, worktreeDir, agentViewCommand };
}

function pickReady(remaining: Map<string, Spec>, deps: Map<string, Set<string>>): Spec | undefined {
  for (const [id, s] of remaining) {
    if (deps.get(id)!.size === 0) return s;
  }
  return undefined;
}

function resolveMaxParallel(override: number | undefined, total: number): number {
  if (override != null && override > 0) return Math.min(override, total);
  const env = Number(process.env.MAX_PARALLEL_AGENTS);
  if (Number.isFinite(env) && env > 0) return Math.min(env, total);
  const cpus = Math.max(1, os.cpus().length);
  return Math.max(1, Math.min(cpus, total));
}

async function spawnTeammate(o: SpawnTeammateOptions): Promise<"finished" | "blocked" | "failed"> {
  const subSpecPath = join(o.stateDir, `${o.subSpecId}.SPEC.md`);
  const prompt = [
    `You are a teammate in a Claude Code Agent Teams swarm.`,
    `Your assigned sub-Spec: ${subSpecPath}`,
    `Shared task list: ${o.sharedTaskListPath}`,
    `Read your sub-Spec carefully, then work autonomously until every completion condition is met.`,
    `Coordinate with peers through the shared task list — claim your tasks, mark them done with evidence, raise questions there.`,
    `When finished emit a FINISHED block with per-condition evidence; when blocked emit BLOCKED with the specific need.`,
  ].join("\n");

  const args = ["-p", prompt, "--dangerously-skip-permissions"];
  if (o.model) args.push("--model", o.model);

  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      args,
      {
        cwd: o.cwd,
        env: {
          ...process.env,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", () => resolve("failed"));
    child.on("close", (code) => {
      if (code !== 0) {
        if (stderr.includes("ENOENT") || stderr.includes("not found")) {
          resolve("failed");
          return;
        }
        resolve("blocked");
        return;
      }
      if (/FINISHED/.test(stdout)) resolve("finished");
      else if (/BLOCKED/.test(stdout)) resolve("blocked");
      else resolve("finished");
    });
  });
}

function renderSharedTaskList(multispec: MultiSpec): string {
  const lines: string[] = [`# Shared Task List for: ${multispec.rootGoal}`, ``, `## Sub-Specs`, ``];
  for (const s of multispec.subSpecs) {
    const id = subSpecIdOf(s);
    lines.push(`- [ ] **${id}** — ${s.title}`);
    for (const cc of s.completionConditions) {
      lines.push(`  - [ ] ${cc.id}: ${cc.description}`);
    }
  }
  lines.push(``, `## Dependencies`, ``);
  for (const d of multispec.dependencies) {
    lines.push(`- ${d.from} depends on ${d.to}`);
  }
  lines.push(``, `## Rollup conditions`, ``);
  for (const cc of multispec.rollupCompletionConditions) {
    lines.push(`- [ ] ${cc.id}: ${cc.description}`);
  }
  return lines.join("\n") + "\n";
}

function subSpecIdOf(spec: Spec): string {
  return spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
