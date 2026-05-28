import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MODELS,
  type FailureCategory,
  type Spec,
  type VerificationFinding,
  type VerificationReport,
} from "@claudemax/core";
import { VERIFIER_SYSTEM } from "./prompts.js";
import {
  baseSdkOptions,
  extractStructuredOutput,
  parseUsageWithCache,
  type EffortLevel,
} from "./sdk-options.js";
import { runInteractiveVerify } from "./interactive-verify.js";
import { judgeWithHaiku, type JudgeAction } from "./haiku-judge.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export interface VerifyOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly env?: Record<string, string>;
  readonly effort?: EffortLevel;
  readonly confidenceThreshold?: number;
  readonly skipInteractive?: boolean;
  readonly doubleCheck?: boolean;
}

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "missing-file",
  "test-failure",
  "build-error",
  "type-error",
  "behavior-mismatch",
  "incomplete-implementation",
  "regression",
  "spec-ambiguity",
  "interactive-failure",
  "unknown",
];

const VERIFICATION_JSON_SCHEMA = {
  type: "object",
  required: ["perCondition", "verdict"],
  properties: {
    perCondition: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "met", "evidence", "confidence"],
        properties: {
          id: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          failureCategory: { type: "string", enum: FAILURE_CATEGORIES as unknown as string[] },
          actionableNext: { type: "string" },
          consolidatedFrom: { type: "array", items: { type: "string" } },
        },
      },
    },
    verdict: { type: "string", enum: ["verified", "partial", "failed"] },
    notes: { type: "string" },
  },
} as const;

export interface RawFinding {
  id: string;
  met: boolean;
  evidence: string;
  confidence?: number;
  failureCategory?: string;
  actionableNext?: string;
  consolidatedFrom?: string[];
}

export async function verify(spec: Spec, opts: VerifyOptions = {}): Promise<VerificationReport> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const interactiveResults = await runInteractiveHints(spec, opts);

  let finalResult = "";

  const base = baseSdkOptions({
    cwd: opts.cwd,
    env: opts.env,
    maxTurns: opts.maxTurns ?? 40,
    effort: opts.effort,
    thinking: "adaptive",
  });
  base["enableFileCheckpointing"] = false;

  const interactiveSection = interactiveResults.length
    ? `\n\nINTERACTIVE PROBES (already executed by the runtime; use as primary evidence):\n${interactiveResults
        .map(
          (r) =>
            `- ${r.conditionId}: tool=${r.tool} met=${r.met} exit=${r.exitCode} dur=${r.durationMs}ms\n  evidence: ${r.evidence}\n  stdout tail: ${truncateOneLine(r.stdoutTail)}\n  stderr tail: ${truncateOneLine(r.stderrTail)}`,
        )
        .join("\n")}\n\nWhen judging a completion condition that has an interactive probe, weigh the probe result as first-hand evidence and assign confidence 0.95+ unless you have a specific reason to doubt it.`
    : "";

  let structured: Record<string, unknown> | null = null;
  for await (const message of query({
    prompt:
      `Verify the SPEC was met. Read the repo, run checks, then output the JSON object exactly as specified.${interactiveSection}`,
    options: {
      model: MODELS.opus.id,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: VERIFIER_SYSTEM(spec),
      },
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      permissionMode: "bypassPermissions",
      outputFormat: { type: "json_schema", schema: VERIFICATION_JSON_SCHEMA },
      ...base,
    } as never,
  })) {
    if (!structured) structured = extractStructuredOutput(message);
    const m = message as { type?: string; result?: string; usage?: unknown };
    if (m.type === "result" && typeof m.result === "string") {
      finalResult = m.result;
      if (m.usage) void parseUsageWithCache(m.usage);
    }
  }

  const parsed = structured
    ? ({
        findings: (structured["perCondition"] ?? []) as readonly RawFinding[],
        verdict: (structured["verdict"] ?? "failed") as "verified" | "partial" | "failed",
        notes: String(structured["notes"] ?? ""),
      } as ExtractedFindings)
    : extractFindings(finalResult);
  if (!parsed) {
    const failed: VerificationFinding[] = spec.completionConditions.map((c) => ({
      id: c.id,
      met: false,
      evidence: "verifier did not return parseable JSON",
      confidence: 1,
      failureCategory: "unknown",
      actionableNext: "re-run verify or inspect prompts/verify.ts for output regression",
    }));
    return {
      spec,
      perCondition: failed,
      suppressedLowConfidence: [],
      verdict: "failed",
      verifierTier: "opus",
      notes: `verifier raw output: ${finalResult.slice(0, 500)}`,
      confidenceThreshold: threshold,
    };
  }

  const findings = normalizeFindings(parsed.findings);
  const { kept, suppressed } = partitionByConfidence(findings, threshold);
  const consolidated = consolidateSimilar(kept);
  const verdict = computeVerdict(consolidated, parsed.verdict);

  const opusReport: VerificationReport = {
    spec,
    perCondition: consolidated,
    suppressedLowConfidence: suppressed,
    verdict,
    verifierTier: "opus",
    notes: parsed.notes,
    confidenceThreshold: threshold,
  };

  if (!opts.doubleCheck) return opusReport;

  const haiku = await runHaikuDoubleCheck(opusReport, opts);
  return applyDoubleCheck(opusReport, haiku);
}

export interface DoubleCheckOutcome {
  readonly verdict: "verified" | "partial" | "failed";
  readonly reason: string;
  readonly action: JudgeAction;
}

async function runHaikuDoubleCheck(
  opus: VerificationReport,
  opts: VerifyOptions,
): Promise<DoubleCheckOutcome> {
  const findings = opus.perCondition
    .map((f) => `- [${f.id}] met=${f.met} conf=${f.confidence.toFixed(2)} :: ${f.evidence}`)
    .join("\n");
  const content = [
    `Opus verifier verdict: ${opus.verdict}`,
    `Spec goal: ${opus.spec.goal}`,
    `Per-condition findings:`,
    findings || "(none)",
    "",
    "You are a NON-AUTHORITATIVE, WARN-only recall check (cross-model: Haiku reviewing an Opus verdict). You do NOT decide the verdict — Opus does. Catch FALSE-PASSES: conditions Opus may have accepted as met that the evidence does not clearly support (the over-optimism / sycophancy failure mode).",
    "Use LOG if the Opus verdict is well-supported. Use WARN/REDACT to flag an over-optimistically accepted condition. Never BLOCK — you cannot override Opus.",
  ].join("\n");
  const v = await judgeWithHaiku(
    {
      content,
      hookName: "verify-double-check",
      categories: ["verifier-disagreement"],
    },
    { cwd: opts.cwd },
  );
  return {
    verdict: actionToVerdict(v.action),
    reason: v.reason,
    action: v.action,
  };
}

function actionToVerdict(a: JudgeAction): "verified" | "partial" | "failed" {
  switch (a) {
    case "LOG":
      return "verified";
    case "WARN":
    case "REDACT":
      return "partial";
    case "BLOCK":
      return "failed";
  }
}

export function applyDoubleCheck(
  opus: VerificationReport,
  haiku:
    | { readonly verdict: "verified" | "partial" | "failed"; readonly reason?: string }
    | undefined,
): VerificationReport {
  if (!haiku) return opus;
  if (opus.verdict === haiku.verdict) return opus;
  // v5-aligned WARN-only recall tier: the Haiku judge NEVER overrides the Opus
  // verdict (house rule #4 — verify authority is Opus). A cross-model disagreement
  // only SURFACES a non-authoritative warning for human review; the verdict stands.
  // Rationale: the llm-dark-patterns v5 cascade study found a strong/deterministic
  // floor + cheap-LLM WARN ceiling beats letting the weak judge override the strong
  // (weak-judge-overriding-strong is an anti-pattern; this catches recall misses
  // without inverting authority).
  const warn = `⚠ haiku-recall-check (non-authoritative, WARN-only): Haiku read this as ${haiku.verdict}${
    haiku.reason ? ` — ${haiku.reason}` : ""
  }. Opus verdict (${opus.verdict}) stands; review if unsure.`;
  return {
    ...opus,
    notes: opus.notes ? `${opus.notes}\n${warn}` : warn,
  };
}

async function runInteractiveHints(
  spec: Spec,
  opts: VerifyOptions,
): Promise<readonly InteractiveProbeRecord[]> {
  if (opts.skipInteractive) return [];
  const probes: InteractiveProbeRecord[] = [];
  for (const cc of spec.completionConditions) {
    if (!cc.interactive) continue;
    const r = await runInteractiveVerify(cc.interactive, { cwd: opts.cwd, env: opts.env });
    probes.push({
      conditionId: cc.id,
      tool: r.tool,
      met: r.met,
      evidence: r.evidence,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdoutTail: r.stdoutTail,
      stderrTail: r.stderrTail,
    });
  }
  return probes;
}

interface InteractiveProbeRecord {
  readonly conditionId: string;
  readonly tool: string;
  readonly met: boolean;
  readonly evidence: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

interface ExtractedFindings {
  readonly findings: readonly RawFinding[];
  readonly verdict: "verified" | "partial" | "failed";
  readonly notes: string;
}

function extractFindings(raw: string): ExtractedFindings | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      perCondition: RawFinding[];
      verdict: "verified" | "partial" | "failed";
      notes?: string;
    };
    return {
      findings: parsed.perCondition ?? [],
      verdict: parsed.verdict,
      notes: parsed.notes ?? "",
    };
  } catch {
    return null;
  }
}

export function normalizeFindings(raw: readonly RawFinding[]): readonly VerificationFinding[] {
  return raw.map((f) => {
    const confidence = clampConfidence(f.confidence);
    const failureCategory = !f.met ? normalizeFailureCategory(f.failureCategory) : undefined;
    const actionableNext = !f.met ? f.actionableNext?.trim() || undefined : undefined;
    return {
      id: f.id,
      met: f.met,
      evidence: f.evidence,
      confidence,
      failureCategory,
      actionableNext,
      consolidatedFrom: f.consolidatedFrom?.length ? f.consolidatedFrom : undefined,
    };
  });
}

function clampConfidence(c: number | undefined): number {
  if (typeof c !== "number" || Number.isNaN(c)) return 0.5;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function normalizeFailureCategory(c: string | undefined): FailureCategory {
  if (!c) return "unknown";
  return (FAILURE_CATEGORIES as readonly string[]).includes(c) ? (c as FailureCategory) : "unknown";
}

export function partitionByConfidence(
  findings: readonly VerificationFinding[],
  threshold: number,
): { kept: readonly VerificationFinding[]; suppressed: readonly VerificationFinding[] } {
  const kept: VerificationFinding[] = [];
  const suppressed: VerificationFinding[] = [];
  for (const f of findings) {
    if (f.confidence >= threshold) kept.push(f);
    else suppressed.push(f);
  }
  return { kept, suppressed };
}

export function consolidateSimilar(
  findings: readonly VerificationFinding[],
): readonly VerificationFinding[] {
  const groups = new Map<string, VerificationFinding[]>();
  const order: string[] = [];
  for (const f of findings) {
    if (f.met) {
      const key = `met:${f.id}`;
      if (!groups.has(key)) order.push(key);
      groups.set(key, [...(groups.get(key) ?? []), f]);
      continue;
    }
    const key = `${f.failureCategory ?? "unknown"}:${rootFileFromEvidence(f.evidence)}`;
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out: VerificationFinding[] = [];
  for (const key of order) {
    const bucket = groups.get(key)!;
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    const primary = bucket[0]!;
    const merged: VerificationFinding = {
      ...primary,
      evidence: `${primary.evidence}  [consolidated with ${bucket.length - 1} other finding(s) sharing category=${primary.failureCategory ?? "unknown"}]`,
      consolidatedFrom: bucket.slice(1).map((b) => b.id),
    };
    out.push(merged);
  }
  return out;
}

const ROOT_FILE_RE = /([\w./\-]+\.\w+)/;
function rootFileFromEvidence(evidence: string): string {
  return ROOT_FILE_RE.exec(evidence)?.[1] ?? "no-file";
}

function computeVerdict(
  findings: readonly VerificationFinding[],
  modelVerdict: "verified" | "partial" | "failed",
): "verified" | "partial" | "failed" {
  if (findings.length === 0) return modelVerdict;
  const allMet = findings.every((f) => f.met);
  const noneMet = findings.every((f) => !f.met);
  if (allMet) return "verified";
  if (noneMet) return "failed";
  return "partial";
}

function truncateOneLine(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? oneLine.slice(0, 240) + "…" : oneLine;
}
