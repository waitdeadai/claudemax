import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MODELS,
  hashString,
  workItemKey,
  type LoopAction,
  type LoopVerdict,
  type ModelId,
} from "@claudemax/core";
import { runConvergeLoop, type ConvergeLoopResult } from "./loop.js";
import { writeSpec } from "./spec-writer.js";
import {
  appendLedger,
  ledgerKeys,
  loadLedger,
  loopStateDir,
  type LedgerEntry,
} from "./loop-ledger.js";
import { fleetBudgetStatus } from "./loop-budget.js";
import { baseSdkOptions, extractStructuredOutput, type EffortLevel } from "./sdk-options.js";

// Archetype B — the standing-loop (docs/LOOP_MODE_PLAN.md §6B). This is the literal
// Boris pattern: a scheduled, input-driven job that on each tick SENSEs external
// state (GitHub/Slack/CI/shell), DECIDEs whether action is needed and what to
// build, ACTs by running the converge-loop per item (bounded scope, dedup'd), and
// REPORTs. Recurrence is the existing `cmax schedule` cron substrate; this module
// is the body that runs on each tick. Every dependency is injectable so the
// orchestration is unit-testable without the SDK, gh, or the network.

export type LoopSource =
  | { readonly kind: "github-prs"; readonly query?: string }
  | { readonly kind: "github-issues"; readonly query?: string }
  | { readonly kind: "shell"; readonly command: string };

export interface StandingLoopSpec {
  readonly name: string;
  readonly intent: string; // "watch open PRs labeled cmax and address review comments"
  readonly schedule: string; // cron expression or every-duration (passed to cmax schedule)
  readonly sources: readonly LoopSource[];
  readonly maxItemsPerTick: number;
  readonly maxCreditUsdPerTick: number;
  readonly perItemCreditUsd: number;
  readonly createdAt: string;
}

export type StandingLoopRunStatus = "active" | "paused";

export interface StandingLoopState {
  readonly status: StandingLoopRunStatus;
  readonly lastTickAt?: string;
  readonly ticks: number;
}

// An item surfaced by SENSE — raw external state, not yet a decision.
export interface SensedItem {
  readonly id: string; // stable external id (PR/issue number, hash of a shell line)
  readonly source: string;
  readonly title: string;
  readonly body: string;
  readonly url?: string;
}

// A DECIDE output — an item triage judged worth acting on, with a build goal.
export interface DecidedItem {
  readonly key: string; // dedup key (workItemKey)
  readonly title: string;
  readonly source: string;
  readonly goal: string;
}

export interface WorkItemOutcome {
  readonly key: string;
  readonly title: string;
  readonly finalAction: LoopAction;
  readonly verdict: LoopVerdict;
  readonly creditUsd: number;
}

export interface TickOutcome {
  readonly name: string;
  readonly sensed: number;
  readonly considered: number;
  readonly acted: readonly WorkItemOutcome[];
  readonly skippedAlreadyDone: number;
  readonly creditUsd: number;
  readonly budgetStopped: boolean;
  readonly paused: boolean;
  readonly ts: string;
}

export interface StandingLoopDeps {
  readonly sense: (src: LoopSource) => Promise<readonly SensedItem[]>;
  readonly triage: (intent: string, items: readonly SensedItem[]) => Promise<readonly DecidedItem[]>;
  readonly act: (item: DecidedItem) => Promise<ConvergeLoopResult>;
  readonly report: (outcome: TickOutcome) => Promise<void>;
}

export interface StandingLoopTickOptions {
  readonly cwd: string;
  readonly stateDir?: string;
  readonly now?: string; // injectable timestamp (Date.now is unavailable in some contexts)
}

export async function runStandingLoopTick(
  spec: StandingLoopSpec,
  deps: StandingLoopDeps,
  opts: StandingLoopTickOptions,
): Promise<TickOutcome> {
  const cwd = opts.cwd;
  const now = opts.now ?? new Date().toISOString();

  const state = loadStandingLoopState(cwd, spec.name, opts.stateDir);
  if (state.status === "paused") {
    return emptyOutcome(spec.name, now, { paused: true });
  }

  const ledger = loadLedger(cwd, spec.name, opts.stateDir);
  const done = ledgerKeys(ledger);

  // SENSE — each source independently; a failing source yields nothing, never
  // aborts the tick.
  const sensedNested = await Promise.all(
    spec.sources.map(async (s) => {
      try {
        return await deps.sense(s);
      } catch {
        return [];
      }
    }),
  );
  const sensed = sensedNested.flat();

  // DECIDE — triage to work items, dedup against the ledger, cap per tick.
  let decided: readonly DecidedItem[] = [];
  try {
    decided = await deps.triage(spec.intent, sensed);
  } catch {
    decided = [];
  }
  const fresh = decided.filter((d) => !done.has(d.key));
  const skippedAlreadyDone = decided.length - fresh.length;
  const considered = fresh.slice(0, Math.max(0, spec.maxItemsPerTick));

  // ACT + VERIFY (verify runs inside the converge-loop). Bounded by the per-tick
  // credit cap AND the fleet ceiling — a "blocked" fleet tag stops new work.
  const acted: WorkItemOutcome[] = [];
  let creditUsd = 0;
  let budgetStopped = false;
  for (const item of considered) {
    if (creditUsd >= spec.maxCreditUsdPerTick) {
      budgetStopped = true;
      break;
    }
    if (fleetBudgetStatus(cwd, creditUsd).blocked) {
      budgetStopped = true;
      break;
    }
    let res: ConvergeLoopResult;
    try {
      res = await deps.act(item);
    } catch (err) {
      // A thrown ACT is transient — do NOT ledger it, so the next tick retries.
      process.stderr.write(
        `  [loop ${spec.name}] act("${item.title}") threw: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      continue;
    }
    creditUsd += res.totalCreditUsd;
    const verdict = res.lastReport?.verdict ?? "unverified";
    const entry: LedgerEntry = {
      key: item.key,
      title: item.title,
      source: item.source,
      verdict,
      action: res.finalAction,
      creditUsd: res.totalCreditUsd,
      ts: now,
    };
    // Ledger every COMPLETED attempt (even a failed verdict) so the loop does not
    // re-attempt the same item every tick and burn the fleet budget.
    appendLedger(cwd, spec.name, entry, opts.stateDir);
    acted.push({
      key: item.key,
      title: item.title,
      finalAction: res.finalAction,
      verdict,
      creditUsd: res.totalCreditUsd,
    });
  }

  const outcome: TickOutcome = {
    name: spec.name,
    sensed: sensed.length,
    considered: considered.length,
    acted,
    skippedAlreadyDone,
    creditUsd,
    budgetStopped,
    paused: false,
    ts: now,
  };

  writeStandingLoopState(
    cwd,
    spec.name,
    { status: "active", lastTickAt: now, ticks: state.ticks + 1 },
    opts.stateDir,
  );
  try {
    await deps.report(outcome);
  } catch {
    // REPORT failures must never fail the tick — the work is already done + ledgered.
  }
  return outcome;
}

function emptyOutcome(
  name: string,
  ts: string,
  over: Partial<TickOutcome> = {},
): TickOutcome {
  return {
    name,
    sensed: 0,
    considered: 0,
    acted: [],
    skippedAlreadyDone: 0,
    creditUsd: 0,
    budgetStopped: false,
    paused: false,
    ts,
    ...over,
  };
}

// ── Live default dependencies (production wiring) ──────────────────────────────

export interface DefaultDepsOptions {
  readonly cwd: string;
  readonly perItemCreditUsd: number;
  readonly model?: ModelId;
  readonly triageModel?: ModelId;
  readonly effort?: EffortLevel;
  readonly env?: Record<string, string>;
  readonly stateDir?: string;
}

export function defaultStandingLoopDeps(
  spec: StandingLoopSpec,
  opts: DefaultDepsOptions,
): StandingLoopDeps {
  return {
    sense: (src) => defaultSense(src, opts.cwd, opts.env),
    triage: (intent, items) => defaultTriage(intent, items, opts),
    act: async (item) => {
      // CONSTRUCT this item's spec, then converge it (ACT). The converge-loop's
      // own blind verify is the source of truth — never the executor's claim.
      const itemSpec = await writeSpec(item.goal, { cwd: opts.cwd });
      return runConvergeLoop(itemSpec, {
        cwd: opts.cwd,
        maxCreditUsd: opts.perItemCreditUsd,
        model: opts.model,
        effort: opts.effort,
        env: opts.env,
      });
    },
    report: (outcome) => defaultReport(outcome, spec, opts),
  };
}

async function defaultSense(
  src: LoopSource,
  cwd: string,
  env?: Record<string, string>,
): Promise<readonly SensedItem[]> {
  const childEnv = { ...process.env, ...(env ?? {}) };
  try {
    if (src.kind === "github-prs" || src.kind === "github-issues") {
      const sub = src.kind === "github-prs" ? "pr" : "issue";
      const args = [sub, "list", "--json", "number,title,body,url", "--limit", "30"];
      if (src.query) args.push("--search", src.query);
      const out = execFileSync("gh", args, { cwd, encoding: "utf8", env: childEnv });
      const arr = JSON.parse(out) as { number: number; title: string; body?: string; url?: string }[];
      return arr.map((p) => ({
        id: `${sub}-${p.number}`,
        source: src.kind,
        title: p.title,
        body: p.body ?? "",
        url: p.url,
      }));
    }
    // shell: each non-empty stdout line is a sensed item.
    const out = execSync(src.command, { cwd, encoding: "utf8", env: childEnv });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => ({ id: hashString(line), source: "shell", title: line.slice(0, 100), body: line }));
  } catch (err) {
    process.stderr.write(
      `  [loop] sense(${src.kind}) failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return [];
  }
}

const TRIAGE_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "act"],
        properties: {
          id: { type: "string" },
          act: { type: "boolean" },
          goal: { type: "string" },
        },
      },
    },
  },
} as const;

const TRIAGE_SYSTEM = `You are the DECIDE stage of an autonomous standing-loop. You are given the loop's intent and a list of sensed external items. For each item, decide whether autonomous action toward the intent is genuinely warranted RIGHT NOW. Be conservative: the default is act:false. Doing nothing is a valid, common, and safe outcome — only set act:true when the item clearly needs work that advances the intent. When act:true, write a precise, self-contained one-paragraph build goal a coding agent could execute without further context. Output only the JSON object.`;

async function defaultTriage(
  intent: string,
  sensed: readonly SensedItem[],
  opts: DefaultDepsOptions,
): Promise<readonly DecidedItem[]> {
  if (!sensed.length) return [];
  const model = opts.triageModel ?? MODELS.sonnet.id;
  const list = sensed
    .map(
      (s, i) =>
        `${i + 1}. id=${s.id} [${s.source}] ${s.title}\n   ${oneLine(s.body).slice(0, 400)}`,
    )
    .join("\n");

  const base = baseSdkOptions({
    cwd: opts.cwd,
    env: opts.env,
    maxTurns: 2,
    effort: "low",
    thinking: "off",
  });
  base["enableFileCheckpointing"] = false;

  let structured: Record<string, unknown> | null = null;
  let finalResult = "";
  for await (const message of query({
    prompt: `Loop intent: ${intent}\n\nSensed items:\n${list}\n\nDecide per item. Output the JSON object.`,
    options: {
      model,
      systemPrompt: { type: "preset", preset: "claude_code", append: TRIAGE_SYSTEM },
      allowedTools: [],
      permissionMode: "bypassPermissions",
      outputFormat: { type: "json_schema", schema: TRIAGE_SCHEMA },
      ...base,
    } as never,
  })) {
    if (!structured) structured = extractStructuredOutput(message);
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  const obj = structured ?? extractJsonObject(finalResult);
  const rawItems = Array.isArray(obj?.["items"]) ? (obj!["items"] as unknown[]) : [];
  const byId = new Map(sensed.map((s) => [s.id, s] as const));
  const out: DecidedItem[] = [];
  for (const raw of rawItems) {
    const it = raw as { id?: string; act?: boolean; goal?: string };
    if (!it.act || !it.id) continue;
    const s = byId.get(it.id);
    if (!s) continue;
    out.push({
      key: workItemKey(s.source, s.id),
      title: s.title,
      source: s.source,
      goal: (it.goal ?? "").trim() || `${intent}: ${s.title}`,
    });
  }
  return out;
}

async function defaultReport(
  outcome: TickOutcome,
  spec: StandingLoopSpec,
  opts: DefaultDepsOptions,
): Promise<void> {
  const line =
    `[loop ${outcome.name}] sensed=${outcome.sensed} considered=${outcome.considered} ` +
    `acted=${outcome.acted.length} skipped=${outcome.skippedAlreadyDone} ` +
    `credit=$${outcome.creditUsd.toFixed(2)}${outcome.budgetStopped ? " (budget-stopped)" : ""}`;
  process.stdout.write(line + "\n");

  const dir = loopStateDir(opts.cwd, spec.name, opts.stateDir);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "ticks.log"), JSON.stringify(outcome) + "\n", "utf8");

  // Optional phone push via ntfy (reuses claudemax's remote stack). Only fires
  // when a topic is configured AND something actually happened.
  const topic = opts.env?.["CMAX_NTFY_TOPIC"] ?? process.env["CMAX_NTFY_TOPIC"];
  if (topic && (outcome.acted.length || outcome.budgetStopped)) {
    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body: `${spec.name}: acted on ${outcome.acted.length} item(s), $${outcome.creditUsd.toFixed(2)}${outcome.budgetStopped ? " — budget stopped" : ""}`,
      });
    } catch {
      // best-effort notify; never fail the tick on a network error
    }
  }
}

// ── Persistence (spec + run-state + listing for the fleet control plane) ───────

function specPath(cwd: string, name: string, stateDir?: string): string {
  return join(loopStateDir(cwd, name, stateDir), "loop.json");
}
function statePath(cwd: string, name: string, stateDir?: string): string {
  return join(loopStateDir(cwd, name, stateDir), "state.json");
}

export function saveStandingLoopSpec(cwd: string, spec: StandingLoopSpec, stateDir?: string): void {
  const dir = loopStateDir(cwd, spec.name, stateDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(specPath(cwd, spec.name, stateDir), JSON.stringify(spec, null, 2), "utf8");
}

export function loadStandingLoopSpec(
  cwd: string,
  name: string,
  stateDir?: string,
): StandingLoopSpec | null {
  const path = specPath(cwd, name, stateDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StandingLoopSpec;
  } catch {
    return null;
  }
}

export function loadStandingLoopState(
  cwd: string,
  name: string,
  stateDir?: string,
): StandingLoopState {
  const path = statePath(cwd, name, stateDir);
  if (!existsSync(path)) return { status: "active", ticks: 0 };
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<StandingLoopState>;
    return { status: s.status === "paused" ? "paused" : "active", lastTickAt: s.lastTickAt, ticks: s.ticks ?? 0 };
  } catch {
    return { status: "active", ticks: 0 };
  }
}

export function writeStandingLoopState(
  cwd: string,
  name: string,
  state: StandingLoopState,
  stateDir?: string,
): void {
  const dir = loopStateDir(cwd, name, stateDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(cwd, name, stateDir), JSON.stringify(state, null, 2), "utf8");
}

export function setStandingLoopStatus(
  cwd: string,
  name: string,
  status: StandingLoopRunStatus,
  stateDir?: string,
): boolean {
  if (!loadStandingLoopSpec(cwd, name, stateDir)) return false;
  const cur = loadStandingLoopState(cwd, name, stateDir);
  writeStandingLoopState(cwd, name, { ...cur, status }, stateDir);
  return true;
}

export function listStandingLoops(cwd: string): readonly StandingLoopSpec[] {
  const root = join(cwd, ".claudemax", "state", "loop");
  if (!existsSync(root)) return [];
  const out: StandingLoopSpec[] = [];
  let dirents: { name: string; isDirectory: () => boolean }[];
  try {
    dirents = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const path = join(root, d.name, "loop.json");
    if (!existsSync(path)) continue;
    try {
      out.push(JSON.parse(readFileSync(path, "utf8")) as StandingLoopSpec);
    } catch {
      // skip a corrupt loop.json
    }
  }
  return out;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
