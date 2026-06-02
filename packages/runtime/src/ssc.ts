// Specification Self-Correction (Frente A.2, arXiv 2507.18742).
//
// Models game tainted/loose specs 50–70% of the time; a test-time loop that
// HARDENS the spec before executing — and re-examines it when a verify "passes
// too easily" — cuts that >90% without touching weights. Two pieces:
//   1. hardenSpec(): a pre-execution pass that tightens gameable verifyHints and
//      adds missing edge/failure/integration coverage (the spec is the contract;
//      a loose contract guarantees gaming).
//   2. detectEasyPass(): a cheap, pure heuristic that flags a "verified" verdict
//      resting on thin/narrated evidence or a happy-path-only spec — the signal to
//      re-examine the spec rather than accept the result.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type Spec, type SpecCompletionCondition, type VerificationReport } from "@claudemax/core";
import { baseSdkOptions, extractStructuredOutput, type EffortLevel } from "./sdk-options.js";
import { isPRCCondition } from "./prc.js";

export interface HardeningPlan {
  // verifyHint replacements for existing conditions (by id).
  readonly tightened: readonly { id: string; verifyHint: string; why: string }[];
  // new conditions covering gaps (edge/failure/integration).
  readonly added: readonly SpecCompletionCondition[];
  readonly notes: string;
}

export interface HardenResult {
  readonly hardened: Spec;
  readonly changes: readonly string[];
}

// Pure: apply a hardening plan to a spec. Tighten matching verifyHints, append new
// conditions (skip ids that already exist). Never removes conditions or edits the
// goal — hardening only raises the bar.
export function applyHardening(spec: Spec, plan: HardeningPlan): HardenResult {
  const changes: string[] = [];
  const byTightenId = new Map(plan.tightened.map((t) => [t.id, t] as const));
  const tightened = spec.completionConditions.map((cc) => {
    const t = byTightenId.get(cc.id);
    if (t && t.verifyHint.trim() && t.verifyHint.trim() !== cc.verifyHint.trim()) {
      changes.push(`tightened ${cc.id}: ${t.why || "verifyHint hardened"}`);
      return { ...cc, verifyHint: t.verifyHint };
    }
    return cc;
  });
  const have = new Set(spec.completionConditions.map((c) => c.id));
  const added = plan.added.filter((c) => c.id && c.verifyHint.trim() && !have.has(c.id));
  for (const a of added) changes.push(`added ${a.id}`);
  return {
    hardened: { ...spec, completionConditions: [...tightened, ...added] },
    changes,
  };
}

export interface SpecHardener {
  (spec: Spec): Promise<HardeningPlan>;
}

export interface HardenOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly effort?: EffortLevel;
  readonly hardener?: SpecHardener; // injection point for tests
}

export async function hardenSpec(spec: Spec, opts: HardenOptions = {}): Promise<HardenResult> {
  const hardener = opts.hardener ?? defaultHardener(opts);
  const plan = await hardener(spec);
  return applyHardening(spec, plan);
}

const GENERIC_RE = /\b(looks good|should work|seems? (?:fine|ok)|appears? to|done|implemented|works|fine)\b/i;
const RIGOR_RE = /\b(test|edge|failure|error|boundary|invalid|regression|throws?|reject|null|empty|concurren)/i;

export interface EasyPassOptions {
  readonly minEvidenceLen?: number;
}

export interface EasyPassResult {
  readonly suspicious: boolean;
  readonly reasons: readonly string[];
}

// Pure: a "verified" verdict resting on thin/generic evidence, or a happy-path-only
// spec, "passed too easily" → re-examine the spec instead of accepting it.
export function detectEasyPass(
  spec: Spec,
  report: VerificationReport,
  opts: EasyPassOptions = {},
): EasyPassResult {
  if (report.verdict !== "verified") {
    return { suspicious: false, reasons: ["verdict is not 'verified' — not an easy pass"] };
  }
  const reasons: string[] = [];
  const minLen = opts.minEvidenceLen ?? 40;
  const met = report.perCondition.filter((f) => f.met);

  const thin = met.filter((f) => f.evidence.trim().length < minLen);
  if (thin.length) {
    reasons.push(
      `${thin.length} met condition(s) have thin (<${minLen} char) evidence: ${thin.map((f) => f.id).join(", ")}`,
    );
  }
  const generic = met.filter((f) => GENERIC_RE.test(f.evidence) && !RIGOR_RE.test(f.evidence));
  if (generic.length) {
    reasons.push(
      `${generic.length} met condition(s) cite generic/narrated evidence: ${generic.map((f) => f.id).join(", ")}`,
    );
  }
  const hasPRC = spec.completionConditions.some(isPRCCondition);
  const hasRigor = spec.completionConditions.some(
    (cc) => RIGOR_RE.test(cc.verifyHint) || RIGOR_RE.test(cc.description),
  );
  if (!hasPRC && !hasRigor) {
    reasons.push(
      "spec is happy-path-only (no PRC bar, no test/edge/failure verifyHint) — the bar may be too low",
    );
  }
  return { suspicious: reasons.length > 0, reasons };
}

// ── Default (live-SDK) hardener ──

const HARDENING_SCHEMA = {
  type: "object",
  required: ["tightened", "added", "notes"],
  properties: {
    tightened: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "verifyHint", "why"],
        properties: {
          id: { type: "string" },
          verifyHint: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    added: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "description", "verifyHint"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          verifyHint: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
} as const;

const SSC_HARDENER_SYSTEM = `You harden a SPEC before any code runs, to remove gameable loopholes. The most common cause of an agent "passing" without solving the task is a loose specification.

For EACH completion condition, ask: could this verifyHint be satisfied by trivial or shallow output — a stub, a hardcoded value, a JSON that passes a shallow schema but omits content, a test that only covers the happy path? If yes, TIGHTEN the verifyHint so it demands concrete, hard-to-game evidence: a specific observable behavior, a named test that includes an edge/failure case, a command + expected exit, a file region with required content.

Then ADD conditions for coverage the spec is missing: edge/boundary cases, failure-mode handling, and end-to-end integration (not just isolated units).

Hard rules:
- Do NOT change the goal. Do NOT remove or weaken conditions. Hardening only raises the bar.
- Keep existing condition ids stable when tightening; use fresh ids (e.g. "h-<n>") for added conditions.
- Output ONLY the HardeningPlan JSON: {"tightened":[{"id","verifyHint","why"}],"added":[{"id","description","verifyHint"}],"notes"}.`;

function defaultHardener(opts: HardenOptions): SpecHardener {
  return async (spec: Spec): Promise<HardeningPlan> => {
    const base = baseSdkOptions({
      cwd: opts.cwd,
      env: opts.env,
      maxTurns: 12,
      effort: opts.effort,
      thinking: "adaptive",
    });
    base["enableFileCheckpointing"] = false;

    const conditions = spec.completionConditions
      .map((c) => `- [${c.id}] ${c.description}\n  verify: ${c.verifyHint}`)
      .join("\n");
    let structured: Record<string, unknown> | null = null;
    for await (const message of query({
      prompt: `Harden this spec. Inspect the repo if helpful, then output the HardeningPlan JSON.\n\nGOAL: ${spec.goal}\n\nCOMPLETION CONDITIONS:\n${conditions}`,
      options: {
        model: MODELS.opus.id,
        systemPrompt: { type: "preset", preset: "claude_code", append: SSC_HARDENER_SYSTEM },
        allowedTools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        outputFormat: { type: "json_schema", schema: HARDENING_SCHEMA },
        ...base,
      } as never,
    })) {
      if (!structured) structured = extractStructuredOutput(message);
    }
    if (!structured) return { tightened: [], added: [], notes: "hardener produced no plan" };
    return {
      tightened: (structured["tightened"] ?? []) as HardeningPlan["tightened"],
      added: (structured["added"] ?? []) as HardeningPlan["added"],
      notes: String(structured["notes"] ?? ""),
    };
  };
}
