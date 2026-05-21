import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, "..", "..", "cli", "dist", "index.js");

export type GoalStatus = "pending" | "running" | "finished" | "partial" | "failed" | "blocked";

export interface GoalSpec {
  readonly id: string;
  readonly goal: string;
  readonly cwd?: string;
}

export interface MultiOrchestratorOptions {
  readonly cwd?: string;
  readonly tdd?: boolean;
  readonly confidence?: number;
  readonly variant?: "opussonnet" | "opusolo";
  readonly mode?: "auto" | "solo" | "teams";
  readonly maxParallel?: number;
  readonly onUpdate?: (snapshot: readonly GoalRunRecord[]) => void;
  readonly tickMs?: number;
  readonly env?: Record<string, string>;
}

export interface GoalRunRecord {
  readonly id: string;
  readonly goal: string;
  readonly cwd: string;
  readonly status: GoalStatus;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly exitCode?: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface MultiOrchestratorResult {
  readonly perGoal: readonly GoalRunRecord[];
  readonly verdict: "all-finished" | "partial" | "all-failed";
  readonly durationMs: number;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export function slugifyGoal(goal: string, fallback = "goal"): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : fallback;
}

export function planGoals(rawGoals: readonly string[], cwd: string): readonly GoalSpec[] {
  const seen = new Set<string>();
  const out: GoalSpec[] = [];
  for (const [i, raw] of rawGoals.entries()) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let id = slugifyGoal(trimmed, `goal-${i + 1}`);
    let suffix = 1;
    while (seen.has(id)) {
      id = `${slugifyGoal(trimmed, `goal-${i + 1}`)}-${++suffix}`;
    }
    seen.add(id);
    out.push({ id, goal: trimmed, cwd });
  }
  return out;
}

export function aggregateVerdict(records: readonly GoalRunRecord[]): MultiOrchestratorResult["verdict"] {
  if (records.length === 0) return "all-failed";
  const finished = records.filter((r) => r.status === "finished").length;
  const failed = records.filter((r) => r.status === "failed" || r.status === "blocked").length;
  if (finished === records.length) return "all-finished";
  if (failed === records.length) return "all-failed";
  return "partial";
}

export async function runMultiOrchestrator(
  rawGoals: readonly string[],
  opts: MultiOrchestratorOptions = {},
): Promise<MultiOrchestratorResult> {
  const cwd = opts.cwd ?? process.cwd();
  const goals = planGoals(rawGoals, cwd);
  if (goals.length === 0) {
    return {
      perGoal: [],
      verdict: "all-failed",
      durationMs: 0,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
  }

  const tickMs = opts.tickMs ?? 5000;
  const startedAt = Date.now();
  const stateDir = resolve(cwd, ".claudemax", "state", `orchestrator-${startedAt}`);
  mkdirSync(stateDir, { recursive: true });

  const records: Map<string, GoalRunRecord> = new Map();
  for (const g of goals) {
    records.set(g.id, {
      id: g.id,
      goal: g.goal,
      cwd: g.cwd ?? cwd,
      status: "pending",
      startedAt,
      stdoutTail: "",
      stderrTail: "",
    });
  }

  const snapshot = (): readonly GoalRunRecord[] => Array.from(records.values());

  const ticker = opts.onUpdate
    ? setInterval(() => opts.onUpdate?.(snapshot()), tickMs)
    : null;

  const maxParallel = opts.maxParallel ?? goals.length;
  const queue = [...goals];
  const active = new Set<Promise<void>>();

  const spawnOne = (g: GoalSpec): Promise<void> =>
    new Promise<void>((resolveP) => {
      const recordCwd = g.cwd ?? cwd;
      records.set(g.id, { ...records.get(g.id)!, status: "running", startedAt: Date.now() });
      const args = ["run", g.goal];
      if (opts.tdd) args.push("--tdd");
      if (opts.confidence != null) args.push("--confidence", String(opts.confidence));
      if (opts.variant) args.push("--variant", opts.variant);
      if (opts.mode) args.push("--mode", opts.mode);

      const memoryPath = join(stateDir, `${g.id}.memory.sqlite`);
      args.push("--memory", memoryPath);

      const env = { ...process.env, ...(opts.env ?? {}) };
      const child = spawn("node", [CLI_BIN, ...args], {
        cwd: recordCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      child.stdout?.on("data", (b: Buffer) => {
        stdoutBuf += b.toString("utf8");
        records.set(g.id, { ...records.get(g.id)!, stdoutTail: tail(stdoutBuf, 1500) });
      });
      child.stderr?.on("data", (b: Buffer) => {
        stderrBuf += b.toString("utf8");
        records.set(g.id, { ...records.get(g.id)!, stderrTail: tail(stderrBuf, 1500) });
      });
      child.on("close", (code) => {
        const status = mapExitCodeToStatus(code, stdoutBuf);
        records.set(g.id, {
          ...records.get(g.id)!,
          status,
          finishedAt: Date.now(),
          exitCode: code ?? -1,
        });
        resolveP();
      });
      child.on("error", (err) => {
        records.set(g.id, {
          ...records.get(g.id)!,
          status: "failed",
          finishedAt: Date.now(),
          exitCode: -1,
          stderrTail: tail(`spawn error: ${err.message}\n${stderrBuf}`, 1500),
        });
        resolveP();
      });
    });

  const pump = async (): Promise<void> => {
    while (queue.length > 0 || active.size > 0) {
      while (active.size < maxParallel && queue.length > 0) {
        const g = queue.shift()!;
        const p = spawnOne(g).finally(() => active.delete(p));
        active.add(p);
      }
      if (active.size > 0) await Promise.race(active);
    }
  };

  await pump();
  if (ticker) clearInterval(ticker);
  const finishedAt = Date.now();
  const finalSnapshot = snapshot();
  opts.onUpdate?.(finalSnapshot);

  return {
    perGoal: finalSnapshot,
    verdict: aggregateVerdict(finalSnapshot),
    durationMs: finishedAt - startedAt,
    startedAt,
    finishedAt,
  };
}

function tail(s: string, n: number): string {
  return s.length > n ? s.slice(s.length - n) : s;
}

const FINISHED_LINE = /\n✓ finished\n?$/;
const PARTIAL_LINE = /\n✗ partial\n?$/;
const FAILED_LINE = /\n✗ failed\n?$/;

export function mapExitCodeToStatus(code: number | null, stdoutTail: string): GoalStatus {
  if (code === 0) return "finished";
  if (FINISHED_LINE.test(stdoutTail)) return "finished";
  if (PARTIAL_LINE.test(stdoutTail)) return "partial";
  if (FAILED_LINE.test(stdoutTail)) return "failed";
  if (code === null) return "blocked";
  return "failed";
}
