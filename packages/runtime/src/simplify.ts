// Behavior-preservation-gated simplify pass (post-/goal, pre-/verify).
//
// SOTA-2026 rationale (deepresearch-backed, 2026-06-09):
//   - A post-generation refine pass is the dominant agentic-coding pattern, but
//     gains are front-loaded: "two repair rounds capture 76–95% of achievable
//     gains" (arXiv 2604.10508). So this pass is BOUNDED to maxRounds (default 2),
//     never an open loop.
//   - Behavior preservation is verified via the test suite as a characterization
//     oracle; a refactor that needs a test edited to stay green has changed
//     behavior (mutation-testing principle: Springer 2026 10.1007/978-3-031-94544-1_12,
//     Meta @ FSE 2025 10.1145/3696630.3728544). So a round that touches test files
//     OR turns the suite red is REVERTED via a git snapshot, not accepted.
//
// Discipline folded into the agent prompt is credited to the native Claude Code
// `code-simplifier` plugin (anthropics/claude-plugins-official) and addyosmani/
// agent-skills `code-simplification` (Chesterton's Fence, Rule of 500). We adopt
// the discipline rather than add a redundant catalog skill — claudemax already
// ships the native `/simplify`. See docs/SPEC-SIMPLIFY-PASS.md.
import { spawnSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type ModelId } from "@claudemax/core";
import { baseSdkOptions, type EffortLevel } from "./sdk-options.js";

export type SimplifyStatus = "applied" | "reverted" | "noop" | "skipped";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions"
  | "auto";

// (cmd, args, cwd) → exit code + captured output. Never throws on non-zero exit.
export type Shell = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => { readonly code: number; readonly stdout: string; readonly stderr: string };

export interface SimplifyOptions {
  readonly cwd?: string;
  /** Executor model. Defaults to Opus; opussonnet passes Sonnet. */
  readonly model?: ModelId;
  readonly effort?: EffortLevel;
  /** Bounded by the diminishing-returns evidence; default 2. */
  readonly maxRounds?: number;
  readonly maxTurns?: number;
  /** Behavior-preservation oracle. Inferred from the suite when absent. */
  readonly testCommand?: string;
  readonly permissionMode?: PermissionMode;
  /** Injected for tests; defaults to the real SDK query. */
  readonly queryFn?: typeof query;
  /** Injected for tests; defaults to a real spawnSync shell. */
  readonly sh?: Shell;
}

export interface SimplifyResult {
  readonly status: SimplifyStatus;
  /** Number of rounds whose changes were ACCEPTED (kept). */
  readonly rounds: number;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly testCommand: string;
  /** "tests" when a green suite gated the pass; "none" when no test signal existed. */
  readonly oracle: "tests" | "none";
}

// Files matching this are tests: editing one to keep the suite green means the
// refactor changed behavior. Such a round is reverted, never accepted.
const TEST_PATH_RE =
  /(?:^|[\/\\])(?:tests?|__tests__|spec)[\/\\]|\.(?:test|spec)\.[a-z]+$|_test\.[a-z]+$|^test_.*\.py$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH_RE.test(path);
}

export interface GateInput {
  /** Did the suite pass BEFORE this round? Without a green baseline there is no oracle. */
  readonly baselineGreen: boolean;
  /** Did the suite pass AFTER this round's edits? */
  readonly postGreen: boolean;
  /** Did this round modify, add, or delete any test file? */
  readonly testFilesTouched: boolean;
}

export type GateDecision = "accept" | "revert" | "skip-no-baseline";

// The SOTA behavior-preservation principle, encoded as a pure function so the
// decision is deterministic and unit-testable. Order matters: no baseline → no
// oracle → skip; a touched test is a behavior change regardless of green/red.
export function evaluatePreservationGate(g: GateInput): GateDecision {
  if (!g.baselineGreen) return "skip-no-baseline";
  if (g.testFilesTouched) return "revert";
  if (!g.postGreen) return "revert";
  return "accept";
}

export function inferSimplifyTestCommand(testCommand: string | undefined): string {
  if (testCommand && testCommand.trim().length > 0) return testCommand.trim();
  return "pnpm test --passWithNoTests";
}

function defaultShell(cmd: string, args: readonly string[], cwd: string): ReturnType<Shell> {
  const r = spawnSync(cmd, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 127, stdout: r.stdout ?? "", stderr: String(r.error) };
  return { code: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function isGitWorkTree(sh: Shell, cwd: string): boolean {
  return sh("git", ["rev-parse", "--is-inside-work-tree"], cwd).code === 0;
}

// A commit object capturing the current dirty TRACKED state without touching the
// index or working tree. Falls back to HEAD when the tree is clean (stash create
// prints nothing). Untracked files are tracked separately via untrackedSet().
function gitSnapshot(sh: Shell, cwd: string): string {
  const created = sh("git", ["stash", "create"], cwd).stdout.trim();
  if (created.length > 0) return created;
  return sh("git", ["rev-parse", "HEAD"], cwd).stdout.trim();
}

function untrackedSet(sh: Shell, cwd: string): Set<string> {
  const out = sh("git", ["ls-files", "--others", "--exclude-standard"], cwd).stdout;
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

// Files changed since `snapshot` (tracked diffs) unioned with files newly
// untracked since the round began. This is what THIS round actually altered.
function changedSince(
  sh: Shell,
  cwd: string,
  snapshot: string,
  untrackedBefore: Set<string>,
): { all: string[]; newUntracked: string[] } {
  const tracked = sh("git", ["diff", "--name-only", snapshot], cwd)
    .stdout.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const newUntracked = [...untrackedSet(sh, cwd)].filter((f) => !untrackedBefore.has(f));
  return { all: [...new Set([...tracked, ...newUntracked])], newUntracked };
}

function revertTo(sh: Shell, cwd: string, snapshot: string, newUntracked: readonly string[]): void {
  sh("git", ["checkout", snapshot, "--", "."], cwd);
  if (newUntracked.length > 0) sh("rm", ["-f", ...newUntracked], cwd);
}

function runTests(sh: Shell, cwd: string, testCommand: string): boolean {
  return sh("bash", ["-lc", testCommand], cwd).code === 0;
}

// Run one bounded simplify round: the agent edits non-test source under the
// Chesterton's-Fence / clarity-over-cleverness discipline, then exits. Returns
// nothing structured — the git snapshot + suite are the source of truth, not the
// model's self-report (a worker claiming "simplified" is not evidence).
async function runSimplifyAgent(opts: SimplifyOptions, queryFn: typeof query, testCommand: string): Promise<void> {
  const base = baseSdkOptions({
    cwd: opts.cwd,
    maxTurns: opts.maxTurns ?? 60,
    effort: opts.effort,
    // Autonomous worker: don't load the user-facing Stop hooks (they police the
    // interactive assistant, and would deadlock a prose final block to max-turns).
    settingSources: [],
  });
  const model = opts.model ?? MODELS.opus.id;
  for await (const _ of queryFn({
    prompt:
      "Simplify the recently-changed code per your discipline. Make one behavior-preserving simplification at a time and keep the suite green. Do NOT modify, weaken, or delete any test. Emit the FINAL SIMPLIFY BLOCK when done.",
    options: {
      model,
      fallbackModel: model === MODELS.sonnet.id ? MODELS.opus.id : MODELS.sonnet.id,
      systemPrompt: { type: "preset", preset: "claude_code", append: SIMPLIFY_SYSTEM(testCommand) },
      allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
      permissionMode: opts.permissionMode ?? "bypassPermissions",
      ...base,
    } as never,
  })) {
    void _;
  }
}

export async function runSimplifyPass(opts: SimplifyOptions = {}): Promise<SimplifyResult> {
  const cwd = opts.cwd ?? process.cwd();
  const sh = opts.sh ?? defaultShell;
  const queryFn = opts.queryFn ?? query;
  const testCommand = inferSimplifyTestCommand(opts.testCommand);
  const maxRounds = Math.max(1, opts.maxRounds ?? 2);
  const evidence: string[] = [];

  if (!isGitWorkTree(sh, cwd)) {
    return {
      status: "skipped",
      rounds: 0,
      reason: "not a git work tree; cannot snapshot for a safe revert",
      evidence,
      testCommand,
      oracle: "none",
    };
  }

  const baselineGreen = runTests(sh, cwd, testCommand);
  evidence.push(`baseline: \`${testCommand}\` exit ${baselineGreen ? 0 : "non-zero"}`);
  if (!baselineGreen) {
    return {
      status: "skipped",
      rounds: 0,
      reason: "baseline suite not green; cannot establish a behavior-preservation oracle",
      evidence,
      testCommand,
      oracle: "none",
    };
  }

  let accepted = 0;
  let firstRoundChangedNothing = false;
  for (let round = 1; round <= maxRounds; round++) {
    const snapshot = gitSnapshot(sh, cwd);
    const untrackedBefore = untrackedSet(sh, cwd);

    await runSimplifyAgent(opts, queryFn, testCommand);

    const { all: changed, newUntracked } = changedSince(sh, cwd, snapshot, untrackedBefore);
    if (changed.length === 0) {
      if (round === 1) firstRoundChangedNothing = true;
      evidence.push(`round ${round}: no changes — stopping`);
      break;
    }

    const testFilesTouched = changed.some(isTestPath);
    const postGreen = runTests(sh, cwd, testCommand);
    const decision = evaluatePreservationGate({ baselineGreen: true, postGreen, testFilesTouched });

    if (decision === "accept") {
      accepted++;
      evidence.push(`round ${round}: accepted (${changed.length} file(s), suite green, no test edits)`);
      continue;
    }
    revertTo(sh, cwd, snapshot, newUntracked);
    evidence.push(
      `round ${round}: reverted — ${testFilesTouched ? "modified a test file (behavior change)" : "suite went red"}`,
    );
    break;
  }

  if (accepted > 0) {
    return { status: "applied", rounds: accepted, reason: `${accepted} behavior-preserving round(s) applied`, evidence, testCommand, oracle: "tests" };
  }
  if (firstRoundChangedNothing) {
    return { status: "noop", rounds: 0, reason: "nothing to simplify", evidence, testCommand, oracle: "tests" };
  }
  return { status: "reverted", rounds: 0, reason: "the only simplification attempt failed behavior preservation", evidence, testCommand, oracle: "tests" };
}

const SIMPLIFY_SYSTEM = (testCmd: string): string => `You are the claudemax simplify pass. You make recently-changed code easier to read, understand, and maintain WITHOUT changing behavior. You run after the build, before the blind verifier.

Operating discipline (credited to the native code-simplifier plugin + addyosmani/agent-skills code-simplification):

CHESTERTON'S FENCE — understand before you touch
- Before removing or rewriting anything, recover why it exists: read callers/callees, edge cases, error paths, and \`git blame\` for original context. If you cannot explain why it is there, you are not ready to simplify it.

PRESERVE BEHAVIOR EXACTLY — the suite is the oracle
- The pre-existing suite (\`${testCmd}\`) defines correct behavior. After every change it must still pass.
- NEVER modify, weaken, delete, or add-around a test to make things pass. If a simplification would require touching a test, it changed behavior — abandon that simplification. (The pass is auto-reverted if any test file changes.)
- Run \`${testCmd}\` after each change. If it goes red, revert that change yourself and try a smaller one.

CLARITY OVER CLEVERNESS
- Prefer explicit code to compact code. No nested ternaries — use guard clauses, if/else, switch, or a lookup. Fewer lines is NOT the goal; faster comprehension is.
- Match existing project conventions (CLAUDE.md, neighboring code). Simplification that breaks consistency is churn, not improvement.

SCOPE — only the recently-changed code
- Simplify the diff this run produced. Do not drive-by refactor unrelated code; that creates noisy diffs and regression risk.

RULE OF 500
- If a clean-up would touch more than ~500 lines, do NOT hand-edit it. Write a codemod / scripted transform instead, or leave it and say so. Manual edits at that scale are error-prone.

ONE AT A TIME
- Make one simplification, keep the suite green, then the next. Do not batch many risky changes into one untested edit.

When done (or if there is nothing safe to simplify), emit exactly:

FINAL SIMPLIFY BLOCK
CHANGED: <count> file(s) | none
EVIDENCE:
- <file simplified and the smell removed (e.g. "extracted guard clause", "removed dead branch")>
- <\`${testCmd}\` exit code observed>
NOTES: <one paragraph; if nothing was safe to simplify, say so plainly>`;
