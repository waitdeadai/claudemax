import { Command } from "commander";
import kleur from "kleur";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  deriveLanes,
  probeHardware,
  detectPlan,
  initialState,
  resumableStateDir,
  writeResumableState,
  updateLane,
  isComplete,
  type ResumableState,
} from "@claudemax/runtime";
import { slugifyGoal } from "@claudemax/runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, "..", "..", "..", "..", "packages", "cli", "dist", "index.js");

export function megaCommand(): Command {
  return new Command("mega")
    .description("Session-limit-aware mega-build: auto-sizes lanes from hardware + plan, runs N parallel cmax-run subprocesses, checkpoints state per lane, ready to be resumed by `cmax resume` (cron-friendly).")
    .argument("[goals...]", "goals as quoted strings; or use --goals-file")
    .option("--goals-file <path>", "newline-separated goals (one per line; # comments allowed)")
    .option("--max-parallel <n>", "explicit lane cap override")
    .option("--variant <variant>", "opussonnet | opusolo", "opussonnet")
    .option("--confidence <n>", "verifier confidence threshold", "0.85")
    .option("--mode <mode>", "auto | solo | teams", "auto")
    .option("--no-tdd", "skip TDD enforcement (default ON)")
    .option("--stagger-ms <n>", "delay between consecutive lane spawns to avoid Anthropic burst-protection throttle", "5000")
    .option("--dry-run", "print derived lane count + plan, exit", false)
    .action(
      async (
        goalsArgs: string[],
        opts: {
          goalsFile?: string;
          maxParallel?: string;
          variant: "opussonnet" | "opusolo";
          confidence: string;
          mode: "auto" | "solo" | "teams";
          tdd: boolean;
          staggerMs: string;
          dryRun: boolean;
        },
      ) => {
        const cwd = process.cwd();
        const goals = collectGoals(goalsArgs, opts.goalsFile);
        if (goals.length === 0) {
          console.error(kleur.red("error: no goals provided. Pass quoted args or --goals-file <path>."));
          process.exit(2);
        }
        const plan = detectPlan();
        const hardware = probeHardware();
        const decision = deriveLanes({
          plan: plan.plan,
          hardware,
          override: opts.maxParallel ? Number(opts.maxParallel) : undefined,
        });

        console.log(kleur.bold("\n  cmax mega  ") + kleur.dim(`/  ${goals.length} goals → ${decision.lanes} parallel lanes  /\n`));
        console.log(kleur.cyan("  plan:        ") + plan.plan + kleur.dim(` (${plan.billing}, era=${plan.era})`));
        console.log(kleur.cyan("  hardware:    ") + `${hardware.availableParallelism} avail / ${hardware.cores} cores / ${hardware.freeMemGB}GB free`);
        console.log(kleur.cyan("  lanes:       ") + decision.lanes + kleur.dim(`  (bottleneck=${decision.bottleneck}; ${decision.reason})`));
        if (hardware.thermallyConstrained) {
          console.log(kleur.yellow("  thermal:     load-average exceeds threshold; lanes halved"));
        }
        if (plan.era === "pre-split") {
          console.log(kleur.yellow("  era warning: pre-split (today, until 2026-06-15); cmax-mega draws from your shared subscription pool. Saturation events trigger a pause + checkpoint; cron-resume picks up later."));
        }
        console.log();

        if (opts.dryRun) {
          console.log(kleur.dim("  --dry-run: not firing lanes"));
          process.exit(0);
        }

        const planned = goals.map((g, i) => ({ id: dedupSlug(g, i, new Set()), goal: g, cwd }));
        const seenSlugs = new Set<string>();
        const lanes = planned.map((p, i) => {
          let id = dedupSlug(p.goal, i, seenSlugs);
          seenSlugs.add(id);
          return { ...p, id };
        });

        const state = initialState(cwd, lanes, {
          variant: opts.variant,
          confidence: Number(opts.confidence),
          mode: opts.mode,
          maxParallel: decision.lanes,
          tdd: opts.tdd !== false,
        });
        writeResumableState(state);

        const stateDir = resumableStateDir(cwd, state.runId);
        const summaryPath = join(stateDir, "summary.md");
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(
          summaryPath,
          `# cmax mega run ${state.runId}\nStarted: ${state.createdAt}\nLanes total: ${lanes.length}\nMax parallel: ${decision.lanes}\n\n## Resume command\n\`cmax resume ${state.runId}\`\n`,
          "utf8",
        );

        console.log(kleur.cyan("  run id:      ") + state.runId);
        console.log(kleur.cyan("  state dir:   ") + stateDir);
        console.log(kleur.dim("  resume any time: cmax resume " + state.runId + "\n"));

        await driveLanes(state, decision.lanes, opts);
      },
    );
}

function collectGoals(args: readonly string[], filePath: string | undefined): readonly string[] {
  const fromArgs = args.map((g) => g.trim()).filter(Boolean);
  if (filePath) {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    const fromFile = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return [...fromArgs, ...fromFile];
  }
  return fromArgs;
}

function dedupSlug(goal: string, idx: number, seen: Set<string>): string {
  let base = slugifyGoal(goal, `goal-${idx + 1}`);
  let id = base;
  let n = 1;
  while (seen.has(id)) id = `${base}-${++n}`;
  return id;
}

export async function driveLanes(
  initialStateArg: ResumableState,
  maxParallel: number,
  opts: { variant: string; confidence: string; mode: string; tdd: boolean; staggerMs?: number | string },
): Promise<void> {
  let state = initialStateArg;
  const queue = Object.values(state.lanes).filter((l) => l.status === "pending" || l.status === "paused");
  const active = new Set<Promise<void>>();
  const staggerMs = Math.max(0, Number(opts.staggerMs ?? 5000) || 0);
  let lanesSpawned = 0;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  const spawnLane = (laneId: string): Promise<void> =>
    new Promise<void>((resolveP) => {
      const lane = state.lanes[laneId]!;
      state = updateLane(state, laneId, {
        status: "running",
        startedAt: new Date().toISOString(),
        attempts: lane.attempts + 1,
      });
      writeResumableState(state);

      const args = ["run", lane.goal, "--variant", opts.variant, "--confidence", opts.confidence];
      if (opts.mode) args.push("--mode", opts.mode);
      if (opts.tdd !== false) args.push("--tdd");
      const memoryPath = join(resumableStateDir(state.cwd, state.runId), `${laneId}.memory.sqlite`);
      args.push("--memory", memoryPath);

      const child = spawn("node", [CLI_BIN, ...args], {
        cwd: lane.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdoutBuf = "";
      let stderrBuf = "";
      let saturationPause = false;
      let pauseReason = "";

      const checkSaturation = (chunk: string, stream: string): void => {
        if (saturationPause) return;
        // Three observed Anthropic throttle signals (all should pause-not-fail):
        // (1) burst protection: "temporarily limiting requests (not your usage limit)"
        // (2) Max subscription pool: "You've hit your session limit · resets <Xpm>"
        // (3) generic: rate-limit / 429 / exceeded / saturation / usage limit
        if (
          /session limit|temporarily limiting requests|rate.?limit|429|exceeded|saturation|usage limit|resets \d+\s*[ap]m/i.test(
            chunk.slice(-2000),
          )
        ) {
          saturationPause = true;
          pauseReason = `rate-limit-shaped ${stream} signal`;
        }
      };
      child.stdout?.on("data", (b: Buffer) => {
        stdoutBuf += b.toString("utf8");
        checkSaturation(stdoutBuf, "stdout");
      });
      child.stderr?.on("data", (b: Buffer) => {
        stderrBuf += b.toString("utf8");
        checkSaturation(stderrBuf, "stderr");
      });
      child.on("close", (code) => {
        const finishedAt = new Date().toISOString();
        let status: typeof lane.status;
        if (saturationPause) {
          status = "paused";
        } else if (code === 0) {
          status = "finished";
        } else if (/\n✗ partial\n?/.test(stdoutBuf)) {
          status = "partial";
        } else {
          status = "failed";
        }
        state = updateLane(state, laneId, {
          status,
          finishedAt,
          exitCode: code ?? -1,
          ...(saturationPause ? { lastPauseReason: pauseReason, lastPauseAt: finishedAt } : {}),
        });
        writeResumableState(state);
        const color =
          status === "finished" ? kleur.green : status === "paused" ? kleur.yellow : status === "partial" ? kleur.yellow : kleur.red;
        console.log(color(`  ${status.padEnd(9)} ${laneId}  exit=${code}`));
        if (status === "failed" || status === "partial") {
          const tail = stderrBuf.slice(-500) || stdoutBuf.slice(-500);
          if (tail) console.log(kleur.dim(`    tail: ${tail.replace(/\s+/g, " ").trim().slice(0, 240)}`));
        }
        resolveP();
      });
      child.on("error", () => resolveP());
    });

  const pump = async (): Promise<void> => {
    while (queue.length > 0 || active.size > 0) {
      while (active.size < maxParallel && queue.length > 0) {
        const lane = queue.shift()!;
        if (lanesSpawned > 0 && staggerMs > 0) {
          await sleep(staggerMs);
        }
        lanesSpawned += 1;
        const p = spawnLane(lane.id).finally(() => active.delete(p));
        active.add(p);
      }
      if (active.size > 0) await Promise.race(active);
    }
  };

  await pump();
  state = { ...state, updatedAt: new Date().toISOString() };
  writeResumableState(state);

  const finished = Object.values(state.lanes).filter((l) => l.status === "finished").length;
  const paused = Object.values(state.lanes).filter((l) => l.status === "paused").length;
  const failed = Object.values(state.lanes).filter((l) => l.status === "failed" || l.status === "partial").length;
  console.log(kleur.bold(`\n=== mega rollup ===`));
  console.log(`  finished: ${kleur.green(String(finished))}  paused: ${kleur.yellow(String(paused))}  failed/partial: ${kleur.red(String(failed))}`);
  if (paused > 0) {
    console.log(kleur.yellow(`\n  ${paused} lane(s) paused. Resume via:`));
    console.log(kleur.cyan(`    cmax resume ${state.runId}`));
  }
  if (isComplete(state)) {
    console.log(kleur.bold("\n  state: complete (no pending lanes)"));
    process.exit(failed > 0 ? 1 : 0);
  } else {
    console.log(kleur.bold("\n  state: paused"));
    process.exit(2);
  }
}
