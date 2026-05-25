import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type ModelId, type Spec, type SpecCompletionCondition } from "@claudemax/core";
import { baseSdkOptions, type EffortLevel } from "./sdk-options.js";

export interface TddCycleOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  /** Executor model for the implement phase. Defaults to Opus; opussonnet passes Sonnet. */
  readonly model?: ModelId;
  readonly effort?: EffortLevel;
  readonly testCommand?: string;
  readonly permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto";
}

export interface TddCycleResult {
  readonly phase: "failing-test-written" | "implementation-done" | "test-passes" | "stalled";
  readonly turnsUsed: number;
  readonly evidence: readonly string[];
  readonly failingTestPath?: string;
  readonly notes: string;
}

export async function runTddCycle(
  spec: Spec,
  opts: TddCycleOptions = {},
): Promise<TddCycleResult> {
  const testCmd = opts.testCommand ?? inferTestCommand(spec);
  let finalResult = "";
  let turnsUsed = 0;

  const base = baseSdkOptions({
    cwd: opts.cwd,
    maxTurns: opts.maxTurns ?? 80,
    effort: opts.effort,
  });

  const sys = TDD_SYSTEM(spec, testCmd);

  for await (const message of query({
    prompt: `Run the TDD cycle for the SPEC. Write the failing test first, then implement, then prove the test passes. Emit the FINAL TDD BLOCK at the end.`,
    options: {
      model: opts.model ?? MODELS.opus.id,
      fallbackModel: (opts.model ?? MODELS.opus.id) === MODELS.sonnet.id ? MODELS.opus.id : MODELS.sonnet.id,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: sys,
      },
      allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
      permissionMode: opts.permissionMode ?? "bypassPermissions",
      ...base,
    } as never,
  })) {
    const m = message as { type?: string; result?: string; num_turns?: number };
    if (typeof m.num_turns === "number") turnsUsed = m.num_turns;
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  return parseTddBlock(finalResult, turnsUsed);
}

function inferTestCommand(spec: Spec): string {
  for (const cc of spec.completionConditions) {
    const m = /(?:pnpm|npm|yarn) (?:test|run test)(?:\s+[\w:\-./]+)?/.exec(cc.verifyHint);
    if (m) return m[0];
  }
  return "pnpm test --passWithNoTests";
}

function ccLine(cc: SpecCompletionCondition, i: number): string {
  return `${i + 1}. [${cc.id}] ${cc.description}\n   verify: ${cc.verifyHint}`;
}

const TDD_SYSTEM = (spec: Spec, testCmd: string): string => `You are the claudemax TDD driver. You execute the test-first cycle strictly:

PHASE 1 — WRITE FAILING TEST
  Author a test that asserts the SPEC's completion conditions. Run \`${testCmd}\`. The test MUST fail; if it passes immediately, the test is not asserting the right thing — fix the test, not the production code, before moving on.

PHASE 2 — IMPLEMENT
  Make the smallest change to production code that could plausibly make the failing test pass. Do not modify the test in this phase.

PHASE 3 — VERIFY TEST PASSES
  Run \`${testCmd}\` again. The test must now pass. If it does not, return to PHASE 2 — do not weaken the test.

GOAL: ${spec.goal}

COMPLETION CONDITIONS:
${spec.completionConditions.map(ccLine).join("\n")}

Rules:
- Never delete or weaken a test you wrote in PHASE 1.
- Never claim PHASE 3 success unless the test command's exit code is 0 and the assertion you added is in the passing output.
- If you cannot author a failing test for a completion condition (e.g., it is purely a behavior verifyHint), say so explicitly in the final block; do not pretend.

When the cycle is complete (or stalled) emit exactly:

FINAL TDD BLOCK
PHASE: failing-test-written | implementation-done | test-passes | stalled
FAILING TEST PATH: <path or none>
EVIDENCE:
- <command and its observed exit code>
- <path to test that asserts the completion condition>
- <path to production code that was modified>
NOTES: <one paragraph; explain blockers if stalled>`;

const TDD_BLOCK = /FINAL TDD BLOCK[\s\S]*$/;
const PHASE_LINE = /PHASE:\s*(failing-test-written|implementation-done|test-passes|stalled)/;
const FAILING_TEST_LINE = /FAILING TEST PATH:\s*(.+)/;
const EVIDENCE_BLOCK = /EVIDENCE:\s*\n([\s\S]*?)\nNOTES:/;
const NOTES_LINE = /NOTES:\s*([\s\S]+)$/;

export function parseTddBlock(raw: string, turnsUsed: number): TddCycleResult {
  const block = TDD_BLOCK.exec(raw)?.[0] ?? raw;
  const phaseMatch = PHASE_LINE.exec(block);
  const phase = (phaseMatch?.[1] ?? "stalled") as TddCycleResult["phase"];
  const failingTestPath = FAILING_TEST_LINE.exec(block)?.[1]?.trim();
  const evidenceRaw = EVIDENCE_BLOCK.exec(block)?.[1] ?? "";
  const evidence = evidenceRaw
    .split("\n")
    .map((l) => l.replace(/^[-\s]+/, "").trim())
    .filter((l) => l.length > 0);
  const notes = NOTES_LINE.exec(block)?.[1]?.trim() ?? "";

  return {
    phase,
    turnsUsed,
    evidence,
    failingTestPath: failingTestPath && failingTestPath !== "none" ? failingTestPath : undefined,
    notes,
  };
}
