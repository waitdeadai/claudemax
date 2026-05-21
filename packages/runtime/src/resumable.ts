import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type LaneStatus = "pending" | "running" | "finished" | "partial" | "failed" | "paused";

export interface ResumableLane {
  readonly id: string;
  readonly goal: string;
  readonly cwd: string;
  status: LaneStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  attempts: number;
  lastPauseReason?: string;
  lastPauseAt?: string;
}

export interface ResumableState {
  readonly version: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly cwd: string;
  readonly orchestrateFlags: Readonly<{
    variant?: string;
    confidence?: number;
    mode?: string;
    maxParallel?: number;
    tdd?: boolean;
  }>;
  updatedAt: string;
  lanes: Readonly<Record<string, ResumableLane>>;
}

const RESUMABLE_STATE_BASE = ".claudemax/state/resumable";

export function resumableStateDir(cwd: string, runId: string): string {
  return resolve(cwd, RESUMABLE_STATE_BASE, runId);
}

export function resumableStatePath(cwd: string, runId: string): string {
  return join(resumableStateDir(cwd, runId), "state.json");
}

export function writeResumableState(state: ResumableState): void {
  const path = resumableStatePath(state.cwd, state.runId);
  mkdirSync(resumableStateDir(state.cwd, state.runId), { recursive: true });
  const out = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
}

export function readResumableState(cwd: string, runId: string): ResumableState | null {
  const path = resumableStatePath(cwd, runId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ResumableState;
}

export function findLatestResumableRun(cwd: string): string | null {
  const base = resolve(cwd, RESUMABLE_STATE_BASE);
  if (!existsSync(base)) return null;
  const entries = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const stat = statSync(join(base, d.name));
      return { id: d.name, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.id ?? null;
}

export function pendingLanes(state: ResumableState): readonly ResumableLane[] {
  return Object.values(state.lanes).filter(
    (l) => l.status === "pending" || l.status === "running" || l.status === "paused",
  );
}

export function isComplete(state: ResumableState): boolean {
  return Object.values(state.lanes).every(
    (l) => l.status === "finished" || l.status === "partial" || l.status === "failed",
  );
}

export function newRunId(): string {
  return `run-${Date.now()}`;
}

export function initialState(
  cwd: string,
  goals: ReadonlyArray<{ id: string; goal: string; cwd: string }>,
  flags: ResumableState["orchestrateFlags"],
): ResumableState {
  const now = new Date().toISOString();
  const runId = newRunId();
  const lanes: Record<string, ResumableLane> = {};
  for (const g of goals) {
    lanes[g.id] = { id: g.id, goal: g.goal, cwd: g.cwd, status: "pending", attempts: 0 };
  }
  return {
    version: 1,
    runId,
    createdAt: now,
    updatedAt: now,
    cwd,
    orchestrateFlags: flags,
    lanes,
  };
}

export function updateLane(
  state: ResumableState,
  laneId: string,
  patch: Partial<ResumableLane>,
): ResumableState {
  const existing = state.lanes[laneId];
  if (!existing) return state;
  const lanes = { ...state.lanes, [laneId]: { ...existing, ...patch } };
  return { ...state, lanes, updatedAt: new Date().toISOString() };
}
