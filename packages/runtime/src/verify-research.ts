// Decomposed research verification — the research-side mirror of verify.ts's
// decomposed SPEC verifier. Replaces "trust the researcher's own citations"
// with per-finding checks run bounded-parallel under harness-owned wall-clocks.
//
// Design per the 2026-06-09 research brief (sources: arXiv:2602.13855 claim-level
// auditability; arXiv:2510.12839 FaStfact cached-content + escalate-on-doubt;
// arXiv:2603.05912 DeepFact Right/Wrong/Unknown; arXiv:2605.06635 fact-check
// collapse under context bloat; anthropic.com/engineering/multi-agent-research-system;
// claude.com/blog 2026-01-23 early-victory mitigation):
//   tier 1 — citation-support judged on the brief's OWN cached excerpts, zero
//            network, Haiku, wide parallelism. Immune to WebFetch hangs.
//   tier 2 — only findings tier 1 could not support: ONE cited-URL spot-check +
//            one fresh search, Sonnet, narrow parallelism, hard timeout.
//   gate  — >30% escalation demand = the synthesis itself is bad → failed-brief;
//           ≥50% unverified = never report success off timeouts → unverified.

import os from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MODELS,
  type KeyFinding,
  type ResearchBrief,
  type ResearchClaimVerdict,
  type ResearchFindingVerification,
  type ResearchVerification,
  type ResearchVerificationVerdict,
} from "@claudemax/core";
import { extractStructuredOutput } from "./sdk-options.js";
import { mapWithConcurrency, withTimeout } from "./concurrency.js";

const TIER1_TIMEOUT_MS = 60_000;
const TIER2_TIMEOUT_MS = 120_000;
const TIER1_MAX_PARALLEL = 8;
const TIER2_MAX_PARALLEL_CAP = 5; // matches Anthropic's published 3–5 subagent fan-out
const MAX_ESCALATION_RATE = 0.3;

export type Tier1Support = "supported" | "partially" | "unsupported" | "cant-tell";

export interface Tier1Result {
  readonly support: Tier1Support;
  readonly evidence: string;
}

export interface Tier2Result {
  readonly verdict: ResearchClaimVerdict;
  readonly evidence: string;
}

export interface VerifyResearchOptions {
  readonly cwd?: string;
  readonly tier1TimeoutMs?: number;
  readonly tier2TimeoutMs?: number;
  readonly tier1MaxParallel?: number;
  readonly tier2MaxParallel?: number;
  readonly maxEscalationRate?: number;
  // Injectable judges so the aggregation/gating logic is unit-testable without
  // query() — same pattern as pipeline-loop's researchFn/decomposeFn.
  readonly tier1Judge?: (
    finding: KeyFinding,
    excerpts: string,
    signal: AbortSignal,
  ) => Promise<Tier1Result>;
  readonly tier2Judge?: (finding: KeyFinding, signal: AbortSignal) => Promise<Tier2Result>;
  readonly onProgress?: (message: string) => void;
}

const TIER1_SCHEMA = {
  type: "object",
  required: ["support", "evidence"],
  properties: {
    support: { type: "string", enum: ["supported", "partially", "unsupported", "cant-tell"] },
    evidence: { type: "string" },
  },
} as const;

const TIER2_SCHEMA = {
  type: "object",
  required: ["verdict", "evidence"],
  properties: {
    verdict: { type: "string", enum: ["supported", "contradicted", "unverified"] },
    evidence: { type: "string" },
  },
} as const;

function excerptsFor(finding: KeyFinding, brief: ResearchBrief): string {
  const rows = brief.sources.filter((s) => finding.sourceUrls.includes(s.url));
  if (rows.length === 0) return "(no matching source excerpts in the brief)";
  return rows
    .map((s) => `SOURCE: ${s.title} (${s.url}, accessed ${s.accessedAt})\nEXCERPT: ${s.excerpt}`)
    .join("\n\n");
}

async function tier1QueryJudge(
  finding: KeyFinding,
  excerpts: string,
  signal: AbortSignal,
  cwd?: string,
): Promise<Tier1Result> {
  let structured: Record<string, unknown> | null = null;
  const ac = new AbortController();
  signal.addEventListener("abort", () => ac.abort());
  for await (const message of query({
    prompt: `CLAIM:\n${finding.finding}\n\nCITED-SOURCE EXCERPTS (the only evidence you may use — do NOT use your own knowledge):\n${excerpts}\n\nDo these excerpts support the claim? Judge ONLY from the excerpts. Return the JSON verdict.`,
    options: {
      model: MODELS.haiku.id,
      systemPrompt:
        "You are a citation-support judge. You receive one claim and the excerpts of its cited sources. Verdict: supported (excerpts clearly back the claim), partially (back the core but not every detail), unsupported (excerpts are topical but do not back the claim, or conflict with it), cant-tell (excerpts too thin to judge). Quote the decisive excerpt fragment in evidence. Never use outside knowledge.",
      allowedTools: [],
      permissionMode: "bypassPermissions",
      maxTurns: 3,
      cwd,
      settingSources: [],
      abortController: ac,
      outputFormat: { type: "json_schema", schema: TIER1_SCHEMA },
    } as never,
  })) {
    if (!structured) structured = extractStructuredOutput(message);
  }
  if (!structured) return { support: "cant-tell", evidence: "judge returned no structured verdict" };
  const support = String(structured["support"] ?? "cant-tell") as Tier1Support;
  return { support, evidence: String(structured["evidence"] ?? "") };
}

async function tier2QueryJudge(
  finding: KeyFinding,
  signal: AbortSignal,
  cwd?: string,
): Promise<Tier2Result> {
  let structured: Record<string, unknown> | null = null;
  const ac = new AbortController();
  signal.addEventListener("abort", () => ac.abort());
  for await (const message of query({
    prompt: `CLAIM:\n${finding.finding}\n\nCITED URLS:\n${finding.sourceUrls.join("\n")}\n\nSpot-check: WebFetch ONE cited URL (pick the most authoritative). If it settles the claim, stop. If it is unreachable or does not settle it, run ONE WebSearch for independent evidence. Then return the JSON verdict: supported / contradicted (live evidence conflicts with the claim) / unverified (could not settle it either way).`,
    options: {
      model: MODELS.sonnet.id,
      fallbackModel: MODELS.haiku.id,
      systemPrompt:
        "You are an escalation fact-checker for one research claim whose cached citations were insufficient. Budget: at most one WebFetch and one WebSearch. Default to unverified when evidence is inconclusive — never guess. Quote the decisive evidence with its URL.",
      allowedTools: ["WebFetch", "WebSearch"],
      permissionMode: "bypassPermissions",
      maxTurns: 8,
      cwd,
      settingSources: [],
      abortController: ac,
      outputFormat: { type: "json_schema", schema: TIER2_SCHEMA },
    } as never,
  })) {
    if (!structured) structured = extractStructuredOutput(message);
  }
  if (!structured) return { verdict: "unverified", evidence: "judge returned no structured verdict" };
  const verdict = String(structured["verdict"] ?? "unverified") as ResearchClaimVerdict;
  return { verdict, evidence: String(structured["evidence"] ?? "") };
}

export async function verifyResearchBrief(
  brief: ResearchBrief,
  opts: VerifyResearchOptions = {},
): Promise<ResearchVerification> {
  const findings = brief.keyFindings;
  if (findings.length === 0) {
    return {
      brief,
      perFinding: [],
      verdict: "verified",
      supportedCount: 0,
      contradictedCount: 0,
      unverifiedCount: 0,
      notes: "no key findings to verify",
    };
  }

  const tier1TimeoutMs = opts.tier1TimeoutMs ?? TIER1_TIMEOUT_MS;
  const tier2TimeoutMs = opts.tier2TimeoutMs ?? TIER2_TIMEOUT_MS;
  const envCap = Number(process.env["MAX_PARALLEL_AGENTS"]);
  const hwCap = Number.isFinite(envCap) && envCap > 0 ? envCap : os.cpus().length;
  const tier1Parallel = opts.tier1MaxParallel ?? TIER1_MAX_PARALLEL;
  const tier2Parallel = opts.tier2MaxParallel ?? Math.min(hwCap, TIER2_MAX_PARALLEL_CAP);
  const maxEscalationRate = opts.maxEscalationRate ?? MAX_ESCALATION_RATE;
  const tier1 = opts.tier1Judge ?? ((f: KeyFinding, e: string, s: AbortSignal) => tier1QueryJudge(f, e, s, opts.cwd));
  const tier2 = opts.tier2Judge ?? ((f: KeyFinding, s: AbortSignal) => tier2QueryJudge(f, s, opts.cwd));

  opts.onProgress?.(`verify-research: tier 1 citation-support over ${findings.length} findings (cached excerpts, no network)`);

  interface Tier1Outcome {
    readonly finding: KeyFinding;
    readonly result: Tier1Result;
    readonly timedOut: boolean;
  }
  const tier1Outcomes: Tier1Outcome[] = await mapWithConcurrency(findings, tier1Parallel, (finding) =>
    withTimeout<Tier1Outcome>(
      async (signal) => ({ finding, result: await tier1(finding, excerptsFor(finding, brief), signal), timedOut: false }),
      tier1TimeoutMs,
      () => ({ finding, result: { support: "cant-tell", evidence: `tier-1 timeout after ${tier1TimeoutMs}ms` }, timedOut: true }),
    ),
  );

  const settled: ResearchFindingVerification[] = [];
  const escalate: Tier1Outcome[] = [];
  for (const o of tier1Outcomes) {
    if (o.result.support === "supported" || o.result.support === "partially") {
      settled.push({ finding: o.finding, verdict: "supported", tier: 1, evidence: o.result.evidence });
    } else {
      escalate.push(o);
    }
  }

  const escalationRate = escalate.length / findings.length;
  let perFinding: ResearchFindingVerification[];
  let verdict: ResearchVerificationVerdict;
  let notes: string;

  if (escalationRate > maxEscalationRate) {
    // The brief itself is bad — re-research beats per-claim repair at this rate
    // (arXiv:2605.06635: mass fact-check failure signals synthesis breakdown).
    perFinding = [
      ...settled,
      ...escalate.map((o) => ({
        finding: o.finding,
        verdict: "unverified" as const,
        tier: 1 as const,
        evidence: o.result.evidence,
        timedOut: o.timedOut || undefined,
      })),
    ];
    verdict = "failed-brief";
    notes = `escalation demand ${(escalationRate * 100).toFixed(0)}% > ${(maxEscalationRate * 100).toFixed(0)}% — brief synthesis unreliable; re-research the topic instead of repairing claims`;
  } else {
    if (escalate.length > 0) {
      opts.onProgress?.(`verify-research: tier 2 escalation for ${escalate.length}/${findings.length} findings (spot-fetch + fresh search)`);
    }
    const tier2Outcomes = await mapWithConcurrency(escalate, tier2Parallel, (o) =>
      withTimeout<ResearchFindingVerification>(
        async (signal) => {
          const r = await tier2(o.finding, signal);
          return { finding: o.finding, verdict: r.verdict, tier: 2, evidence: r.evidence };
        },
        tier2TimeoutMs,
        () => ({
          finding: o.finding,
          verdict: "unverified",
          tier: 2,
          evidence: `tier-2 timeout after ${tier2TimeoutMs}ms`,
          timedOut: true,
        }),
      ),
    );
    perFinding = [...settled, ...tier2Outcomes];
    const supported = perFinding.filter((f) => f.verdict === "supported").length;
    const contradicted = perFinding.filter((f) => f.verdict === "contradicted").length;
    const unverified = perFinding.filter((f) => f.verdict === "unverified").length;
    if (unverified / findings.length >= 0.5) {
      verdict = "unverified"; // early-victory mitigation: timeouts are not evidence
    } else if (contradicted === 0 && supported / findings.length >= 0.8) {
      verdict = "verified";
    } else {
      verdict = "partial";
    }
    notes = `${supported} supported, ${contradicted} contradicted, ${unverified} unverified of ${findings.length}`;
  }

  const supportedCount = perFinding.filter((f) => f.verdict === "supported").length;
  const contradictedCount = perFinding.filter((f) => f.verdict === "contradicted").length;
  const unverifiedCount = perFinding.filter((f) => f.verdict === "unverified").length;

  const contradictedSet = new Set(
    perFinding.filter((f) => f.verdict === "contradicted").map((f) => f.finding.finding),
  );
  const unverifiedSet = new Set(
    perFinding.filter((f) => f.verdict === "unverified").map((f) => f.finding.finding),
  );
  const annotated: ResearchBrief = {
    ...brief,
    keyFindings: brief.keyFindings
      .filter((kf) => !contradictedSet.has(kf.finding))
      .map((kf) =>
        unverifiedSet.has(kf.finding) ? { ...kf, finding: `[unverified] ${kf.finding}` } : kf,
      ),
    openQuestions: [
      ...brief.openQuestions,
      ...perFinding
        .filter((f) => f.verdict === "contradicted")
        .map((f) => `CONTRADICTED by verification (dropped): ${f.finding.finding} — ${f.evidence}`),
    ],
  };

  opts.onProgress?.(`verify-research: ${verdict} — ${notes}`);

  return {
    brief: annotated,
    perFinding,
    verdict,
    supportedCount,
    contradictedCount,
    unverifiedCount,
    notes,
  };
}
