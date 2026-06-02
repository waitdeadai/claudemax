import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MODELS,
  type FailureCategory,
  type Spec,
  type SpecCompletionCondition,
  type VerificationFinding,
  type VerificationReport,
} from "@claudemax/core";
import { VERIFIER_ONE_SYSTEM, VERIFIER_SYSTEM } from "./prompts.js";
import {
  baseSdkOptions,
  extractStructuredOutput,
  parseUsageWithCache,
  type EffortLevel,
} from "./sdk-options.js";
import { runInteractiveVerify } from "./interactive-verify.js";
import { judgeWithHaiku, type JudgeAction } from "./haiku-judge.js";
import { clearActiveRunIfMatches, writeVerdict, type VerdictValue } from "./verdict-artifact.js";
import { mapWithConcurrency, withTimeout } from "./concurrency.js";
import {
  adversarialVerify,
  applyAdversarialDowngrade,
  type AdversarialJudges,
} from "./mutation-verify.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
// Decomposed verify (Frente B.1): one blind Opus agent per completion condition,
// bounded-parallel, each with a hard wall-clock timeout. A hung condition fails
// only itself instead of stalling a monolithic whole-spec pass.
const DEFAULT_PER_CONDITION_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_PARALLEL = 4;
const DEFAULT_PER_CONDITION_MAX_TURNS = 16;

export interface VerifyOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly env?: Record<string, string>;
  readonly effort?: EffortLevel;
  readonly confidenceThreshold?: number;
  readonly skipInteractive?: boolean;
  readonly doubleCheck?: boolean;
  // Decomposed verify controls (default ON). Set `decomposed:false` for the legacy
  // single-query whole-spec pass (cheaper, but no per-condition timeout isolation).
  readonly decomposed?: boolean;
  readonly maxParallel?: number;
  readonly perConditionTimeoutMs?: number;
  readonly perConditionMaxTurns?: number;
  // Persist the verdict artifact the Stop/SubagentStop gate reads (default ON).
  readonly writeArtifact?: boolean;
  // Adversarial / mutation verify (Frente B.2, opt-in): stress-test the verifier
  // against fabricated claims + an isomorphic restatement; downgrade any MET
  // condition the verifier can be fooled about before computing the verdict.
  readonly adversarial?: boolean;
  readonly adversarialJudges?: AdversarialJudges; // injection point for tests
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

// Whole-spec schema for the legacy monolithic path (decomposed:false).
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

// Single-condition schema for the decomposed path. One object, not an array — a
// sharper, harder-to-game contract for one verifier judging one condition.
const ONE_CONDITION_SCHEMA = {
  type: "object",
  required: ["met", "evidence", "confidence"],
  properties: {
    met: { type: "boolean" },
    evidence: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    failureCategory: { type: "string", enum: FAILURE_CATEGORIES as unknown as string[] },
    actionableNext: { type: "string" },
    evidenceArtifacts: { type: "array", items: { type: "string" } },
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
  evidenceArtifacts?: string[];
  timedOut?: boolean;
}

export async function verify(spec: Spec, opts: VerifyOptions = {}): Promise<VerificationReport> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const cwd = opts.cwd ?? process.cwd();
  const probes = await runInteractiveHints(spec, opts);

  let findings: readonly VerificationFinding[];
  if (opts.decomposed === false) {
    findings = await verifyMonolithic(spec, probes, opts);
  } else {
    const runner: ConditionRunner = (cc, probe, signal) =>
      runConditionDefault(
        spec,
        cc,
        probe,
        {
          cwd,
          env: opts.env,
          effort: opts.effort,
          perConditionMaxTurns: opts.perConditionMaxTurns,
        },
        signal,
      );
    findings = await verifyDecomposed(spec, toConditionMap(probes), runner, {
      maxParallel: opts.maxParallel,
      perConditionTimeoutMs: opts.perConditionTimeoutMs,
    });
  }

  // Apply default-FAIL completeness + evidence-required uniformly to both paths:
  // every declared condition gets a finding (a missing one is default-FAIL), and a
  // "met" with no evidence is downgraded to not-met.
  const complete = enforceEvidence(fillMissingConditions(spec, findings));

  // Adversarial pass (Frente B.2, opt-in): a MET condition the verifier can be
  // fooled about (accepts a fabricated claim, or flips under an equivalent
  // restatement) is downgraded to not-met BEFORE the verdict is computed.
  let adjudicated = complete;
  let adversarialSummary: {
    conditionId: string;
    rejectionRate: number;
    isomorphicStable: boolean;
    gameable: boolean;
  }[] = [];
  if (opts.adversarial) {
    const metIds = complete.filter((f) => f.met).map((f) => f.id);
    if (metIds.length) {
      try {
        const results = await adversarialVerify(spec, metIds, {
          cwd,
          env: opts.env,
          effort: opts.effort,
          ...(opts.adversarialJudges ? { judges: opts.adversarialJudges } : {}),
        });
        adjudicated = applyAdversarialDowngrade(complete, results);
        adversarialSummary = results.map((r) => ({
          conditionId: r.conditionId,
          rejectionRate: r.rejectionRate,
          isomorphicStable: r.isomorphicStable,
          gameable: r.gameable,
        }));
      } catch {
        // Adversarial is a SECONDARY layer; it must never crash verify or fail
        // conditions on a tool error. Skip it — the decomposed, evidence-required
        // verdict remains the source of truth.
        adjudicated = complete;
        adversarialSummary = [];
      }
    }
  }

  const { kept, suppressed } = partitionByConfidence(adjudicated, threshold);
  const consolidated = consolidateSimilar(kept);
  const verdict = computeVerdictStrict(spec, adjudicated, threshold);

  const total = spec.completionConditions.length;
  const passed = adjudicated.filter(
    (f) => f.met && f.confidence >= threshold && f.evidence.trim() !== "",
  ).length;
  const timedOut = adjudicated.filter((f) => f.timedOut).length;
  const gameableCount = adversarialSummary.filter((a) => a.gameable).length;
  const notes =
    `${passed}/${total} conditions verified-with-evidence` +
    (timedOut ? `; ${timedOut} timed out` : "") +
    (adversarialSummary.length
      ? `; adversarial: ${gameableCount}/${adversarialSummary.length} flagged gameable`
      : "");

  let report: VerificationReport = {
    spec,
    perCondition: consolidated,
    suppressedLowConfidence: suppressed,
    verdict,
    verifierTier: "opus",
    notes,
    confidenceThreshold: threshold,
  };

  if (opts.writeArtifact !== false) {
    const { path, artifact } = writeVerdict({
      spec,
      allFindings: adjudicated,
      verdict,
      verifierTier: "opus",
      confidenceThreshold: threshold,
      cwd,
      ...(adversarialSummary.length ? { adversarial: adversarialSummary } : {}),
    });
    report = { ...report, verdictArtifactPath: path };
    // Only a fully-passing gate clears the active-run sentinel, and only when the
    // verdict is for THIS run's spec (a passing sub-Spec verify must not clear the
    // root run's sentinel). Otherwise the completion gate keeps the autonomous run
    // from stopping at a fake "done".
    if (artifact.gate.pass) clearActiveRunIfMatches(cwd, artifact.specHash);
  }

  if (!opts.doubleCheck) return report;

  const haiku = await runHaikuDoubleCheck(report, opts);
  return applyDoubleCheck(report, haiku);
}

// ── Decomposed verification core (injectable runner → unit-testable w/o the SDK) ──

export interface ConditionRunner {
  (
    cc: SpecCompletionCondition,
    probe: InteractiveProbeRecord | undefined,
    signal: AbortSignal,
  ): Promise<RawFinding>;
}

export interface DecomposedOptions {
  readonly maxParallel?: number;
  readonly perConditionTimeoutMs?: number;
}

export async function verifyDecomposed(
  spec: Spec,
  interactiveByCondition: ReadonlyMap<string, InteractiveProbeRecord>,
  runner: ConditionRunner,
  opts: DecomposedOptions = {},
): Promise<readonly VerificationFinding[]> {
  const timeoutMs = opts.perConditionTimeoutMs ?? DEFAULT_PER_CONDITION_TIMEOUT_MS;
  const maxParallel = opts.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const raws = await mapWithConcurrency(spec.completionConditions, maxParallel, (cc) =>
    withTimeout(
      (signal) => runner(cc, interactiveByCondition.get(cc.id), signal),
      timeoutMs,
      () => timedOutRaw(cc, timeoutMs),
    ),
  );
  return normalizeFindings(raws);
}

interface ConditionRunCtx {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly effort?: EffortLevel;
  readonly perConditionMaxTurns?: number;
}

async function runConditionDefault(
  spec: Spec,
  cc: SpecCompletionCondition,
  probe: InteractiveProbeRecord | undefined,
  ctx: ConditionRunCtx,
  signal: AbortSignal,
): Promise<RawFinding> {
  const base = baseSdkOptions({
    cwd: ctx.cwd,
    env: ctx.env,
    maxTurns: ctx.perConditionMaxTurns ?? DEFAULT_PER_CONDITION_MAX_TURNS,
    effort: ctx.effort,
    thinking: "adaptive",
    abortSignal: signal,
  });
  base["enableFileCheckpointing"] = false;

  const probeSection = probe
    ? `\n\nINTERACTIVE PROBE (already executed by the runtime — first-hand evidence):\n- tool=${probe.tool} met=${probe.met} exit=${probe.exitCode} dur=${probe.durationMs}ms\n  evidence: ${probe.evidence}\n  stdout tail: ${truncateOneLine(probe.stdoutTail)}\n  stderr tail: ${truncateOneLine(probe.stderrTail)}`
    : "";

  try {
    let structured: Record<string, unknown> | null = null;
    let finalResult = "";
    for await (const message of query({
      prompt: `Verify EXACTLY ONE completion condition ([${cc.id}]) was met. Read the repo, run the check, then output the JSON object exactly as specified.${probeSection}`,
      options: {
        model: MODELS.opus.id,
        systemPrompt: { type: "preset", preset: "claude_code", append: VERIFIER_ONE_SYSTEM(spec, cc) },
        allowedTools: ["Read", "Glob", "Grep", "Bash"],
        permissionMode: "bypassPermissions",
        outputFormat: { type: "json_schema", schema: ONE_CONDITION_SCHEMA },
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
    return parseOneCondition(structured, finalResult, cc, probe);
  } catch (err) {
    return errorRaw(cc, err instanceof Error ? err.message : String(err));
  }
}

export function parseOneCondition(
  structured: Record<string, unknown> | null,
  finalResult: string,
  cc: SpecCompletionCondition,
  probe: InteractiveProbeRecord | undefined,
): RawFinding {
  const obj = structured ?? extractJsonObject(finalResult);
  if (!obj) return noResultRaw(cc);

  const modelMet = obj["met"] === true;
  // The mechanical probe is authoritative: a failed probe forces met:false no
  // matter how the model reads the code (kills "hardcoded for the visible case").
  const probeOk = !probe || probe.met;
  const met = modelMet && probeOk;

  let evidence = String(obj["evidence"] ?? "").trim();
  if (probe && !probe.met) {
    evidence = `${evidence ? evidence + " | " : ""}interactive probe failed: ${probe.evidence}`.trim();
  }
  if (!evidence && probe) evidence = probe.evidence;

  const confidence = typeof obj["confidence"] === "number" ? (obj["confidence"] as number) : undefined;
  const rawArtifacts = Array.isArray(obj["evidenceArtifacts"])
    ? (obj["evidenceArtifacts"] as unknown[]).map((a) => String(a)).filter((a) => a.trim() !== "")
    : undefined;

  const failureCategory = met
    ? undefined
    : !probeOk
      ? "interactive-failure"
      : typeof obj["failureCategory"] === "string"
        ? (obj["failureCategory"] as string)
        : "incomplete-implementation";

  return {
    id: cc.id,
    met,
    evidence: evidence || (met ? "" : "condition not met"),
    confidence,
    failureCategory,
    actionableNext:
      !met && typeof obj["actionableNext"] === "string" ? (obj["actionableNext"] as string) : undefined,
    evidenceArtifacts: rawArtifacts && rawArtifacts.length ? rawArtifacts : undefined,
  };
}

function timedOutRaw(cc: SpecCompletionCondition, ms: number): RawFinding {
  return {
    id: cc.id,
    met: false,
    evidence: `per-condition verifier timed out after ${ms}ms (default-FAIL)`,
    confidence: 1,
    failureCategory: "interactive-failure",
    actionableNext: `raise perConditionTimeoutMs or split condition "${cc.id}" into smaller checks`,
    timedOut: true,
  };
}

function noResultRaw(cc: SpecCompletionCondition): RawFinding {
  return {
    id: cc.id,
    met: false,
    evidence: "per-condition verifier returned no parseable JSON (default-FAIL)",
    confidence: 1,
    failureCategory: "unknown",
    actionableNext: "re-run verify; check the per-condition output format in prompts/verify",
  };
}

function errorRaw(cc: SpecCompletionCondition, msg: string): RawFinding {
  return {
    id: cc.id,
    met: false,
    evidence: `per-condition verifier errored: ${msg} (default-FAIL)`,
    confidence: 1,
    failureCategory: "unknown",
    actionableNext: "inspect the verifier error and re-run",
  };
}

// ── Default-FAIL completeness + evidence-required (shared by both paths) ──

// Every declared condition must have a finding. A condition with none is
// default-FAIL — this closes the hole where the model silently omits a condition
// and it vanishes from the verdict.
export function fillMissingConditions(
  spec: Spec,
  findings: readonly VerificationFinding[],
): readonly VerificationFinding[] {
  const byId = new Map(findings.map((f) => [f.id, f] as const));
  return spec.completionConditions.map(
    (cc) =>
      byId.get(cc.id) ??
      ({
        id: cc.id,
        met: false,
        evidence: "no verifier finding was produced for this condition (default-FAIL)",
        confidence: 1,
        failureCategory: "incomplete-implementation",
        actionableNext: `run the verifier for condition "${cc.id}"`,
      } satisfies VerificationFinding),
  );
}

// A condition marked met with empty evidence is downgraded to not-met. "Met" must
// be earned with a concrete observation, never narrated (Frente B.4).
export function enforceEvidence(
  findings: readonly VerificationFinding[],
): readonly VerificationFinding[] {
  return findings.map((f) => {
    if (f.met && f.evidence.trim() === "") {
      return {
        ...f,
        met: false,
        evidence: "marked met without evidence (evidence-required → default-FAIL)",
        failureCategory: f.failureCategory ?? "incomplete-implementation",
        actionableNext:
          f.actionableNext ?? "produce concrete first-hand evidence (command output / file / passing test)",
      };
    }
    return f;
  });
}

// Strict, default-FAIL verdict: a condition counts as passed ONLY if met AND
// confidence >= threshold AND evidence non-empty. "verified" requires every
// declared condition to pass. Zero conditions => "unverified" (nothing verifiable).
export function computeVerdictStrict(
  spec: Spec,
  findings: readonly VerificationFinding[],
  threshold: number,
): VerdictValue {
  const total = spec.completionConditions.length;
  if (total === 0) return "unverified";
  const byId = new Map(findings.map((f) => [f.id, f] as const));
  let passed = 0;
  for (const cc of spec.completionConditions) {
    const f = byId.get(cc.id);
    if (f && f.met && f.confidence >= threshold && f.evidence.trim() !== "") passed++;
  }
  if (passed === total) return "verified";
  if (passed === 0) return "failed";
  return "partial";
}

// Bounded-parallel runner + per-unit wall-clock timeout live in ./concurrency.js
// (shared with mutation-verify, no import cycle). Re-exported for back-compat.
export { mapWithConcurrency, withTimeout } from "./concurrency.js";

// ── Legacy monolithic path (decomposed:false) ──

async function verifyMonolithic(
  spec: Spec,
  probes: readonly InteractiveProbeRecord[],
  opts: VerifyOptions,
): Promise<readonly VerificationFinding[]> {
  const base = baseSdkOptions({
    cwd: opts.cwd,
    env: opts.env,
    maxTurns: opts.maxTurns ?? 40,
    effort: opts.effort,
    thinking: "adaptive",
  });
  base["enableFileCheckpointing"] = false;

  const interactiveSection = probes.length
    ? `\n\nINTERACTIVE PROBES (already executed by the runtime; use as primary evidence):\n${probes
        .map(
          (r) =>
            `- ${r.conditionId}: tool=${r.tool} met=${r.met} exit=${r.exitCode} dur=${r.durationMs}ms\n  evidence: ${r.evidence}\n  stdout tail: ${truncateOneLine(r.stdoutTail)}\n  stderr tail: ${truncateOneLine(r.stderrTail)}`,
        )
        .join("\n")}\n\nWhen judging a completion condition that has an interactive probe, weigh the probe result as first-hand evidence and assign confidence 0.95+ unless you have a specific reason to doubt it.`
    : "";

  let structured: Record<string, unknown> | null = null;
  let finalResult = "";
  for await (const message of query({
    prompt: `Verify the SPEC was met. Read the repo, run checks, then output the JSON object exactly as specified.${interactiveSection}`,
    options: {
      model: MODELS.opus.id,
      systemPrompt: { type: "preset", preset: "claude_code", append: VERIFIER_SYSTEM(spec) },
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

  const raw = structured
    ? ((structured["perCondition"] ?? []) as RawFinding[])
    : (extractFindings(finalResult)?.findings ?? null);
  if (!raw) return [];
  return normalizeFindings(raw);
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

function toConditionMap(
  probes: readonly InteractiveProbeRecord[],
): ReadonlyMap<string, InteractiveProbeRecord> {
  return new Map(probes.map((p) => [p.conditionId, p] as const));
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

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractFindings(raw: string): ExtractedFindings | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const parsed = obj as {
    perCondition?: RawFinding[];
    verdict?: "verified" | "partial" | "failed";
    notes?: string;
  };
  return {
    findings: parsed.perCondition ?? [],
    verdict: parsed.verdict ?? "failed",
    notes: parsed.notes ?? "",
  };
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
      evidenceArtifacts: f.evidenceArtifacts?.length ? f.evidenceArtifacts : undefined,
      timedOut: f.timedOut ? true : undefined,
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

function truncateOneLine(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? oneLine.slice(0, 240) + "…" : oneLine;
}
