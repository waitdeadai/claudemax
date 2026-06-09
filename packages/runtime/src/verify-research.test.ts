import { describe, expect, it, vi } from "vitest";
import type { KeyFinding, ResearchBrief } from "@claudemax/core";
import { verifyResearchBrief, type Tier1Result, type Tier2Result } from "./verify-research.js";

function brief(findings: string[], opts: { excerpts?: boolean } = {}): ResearchBrief {
  const withExcerpts = opts.excerpts !== false;
  return {
    topic: "t",
    summary: "s",
    keyFindings: findings.map((f, i) => ({ finding: f, sourceUrls: [`https://x.test/${i}`] })),
    sources: withExcerpts
      ? findings.map((_, i) => ({
          url: `https://x.test/${i}`,
          title: `src ${i}`,
          accessedAt: "2026-06-09",
          relevance: 1,
          excerpt: `excerpt ${i}`,
        }))
      : [],
    openQuestions: [],
    createdAt: "2026-06-09",
  };
}

const supportedT1 = async (): Promise<Tier1Result> => ({ support: "supported", evidence: "ok" });

describe("verifyResearchBrief", () => {
  it("trivially verifies an empty brief without calling judges", async () => {
    const t1 = vi.fn(supportedT1);
    const r = await verifyResearchBrief(brief([]), { tier1Judge: t1 });
    expect(r.verdict).toBe("verified");
    expect(t1).not.toHaveBeenCalled();
  });

  it("verifies when all findings pass tier 1 (no tier-2 calls)", async () => {
    const t2 = vi.fn(async (): Promise<Tier2Result> => ({ verdict: "supported", evidence: "" }));
    const r = await verifyResearchBrief(brief(["a", "b", "c"]), {
      tier1Judge: supportedT1,
      tier2Judge: t2,
    });
    expect(r.verdict).toBe("verified");
    expect(r.supportedCount).toBe(3);
    expect(r.perFinding.every((f) => f.tier === 1)).toBe(true);
    expect(t2).not.toHaveBeenCalled();
  });

  it("treats partially as supported at tier 1", async () => {
    const r = await verifyResearchBrief(brief(["a"]), {
      tier1Judge: async () => ({ support: "partially", evidence: "core backed" }),
    });
    expect(r.verdict).toBe("verified");
  });

  it("escalates unsupported findings to tier 2 and strips contradicted ones", async () => {
    const b = brief(["good1", "good2", "good3", "bad"]);
    const r = await verifyResearchBrief(b, {
      tier1Judge: async (f: KeyFinding) =>
        f.finding === "bad"
          ? { support: "unsupported", evidence: "excerpt conflicts" }
          : { support: "supported", evidence: "ok" },
      tier2Judge: async () => ({ verdict: "contradicted", evidence: "live source disagrees" }),
    });
    expect(r.verdict).toBe("partial");
    expect(r.contradictedCount).toBe(1);
    expect(r.brief.keyFindings.map((k) => k.finding)).toEqual(["good1", "good2", "good3"]);
    expect(r.brief.openQuestions.some((q) => q.includes("CONTRADICTED"))).toBe(true);
  });

  it("flags tier-2 unverified findings in the annotated brief", async () => {
    const b = brief(["good1", "good2", "good3", "shaky"]);
    const r = await verifyResearchBrief(b, {
      tier1Judge: async (f: KeyFinding) =>
        f.finding === "shaky" ? { support: "cant-tell", evidence: "" } : { support: "supported", evidence: "ok" },
      tier2Judge: async () => ({ verdict: "unverified", evidence: "could not settle" }),
    });
    expect(r.unverifiedCount).toBe(1);
    expect(r.brief.keyFindings.some((k) => k.finding.startsWith("[unverified] shaky"))).toBe(true);
  });

  it("closes failed-brief when escalation demand exceeds the cap, skipping tier 2", async () => {
    const t2 = vi.fn(async (): Promise<Tier2Result> => ({ verdict: "supported", evidence: "" }));
    const r = await verifyResearchBrief(brief(["a", "b", "c", "d"]), {
      tier1Judge: async (f: KeyFinding) =>
        f.finding === "a" ? { support: "supported", evidence: "ok" } : { support: "cant-tell", evidence: "" },
      tier2Judge: t2,
    });
    expect(r.verdict).toBe("failed-brief");
    expect(t2).not.toHaveBeenCalled();
    expect(r.unverifiedCount).toBe(3);
  });

  it("never reports success off mass timeouts (tier-2 timeout → unverified gate)", async () => {
    const b = brief(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const r = await verifyResearchBrief(b, {
      // 7 supported, 3 escalate (30% — at the cap, not over it)
      tier1Judge: async (f: KeyFinding) =>
        ["a", "b", "c"].includes(f.finding)
          ? { support: "cant-tell", evidence: "" }
          : { support: "supported", evidence: "ok" },
      tier2Judge: () => new Promise(() => {}), // hangs — harness wall-clock must fire
      tier2TimeoutMs: 50,
    });
    expect(r.perFinding.filter((f) => f.timedOut).length).toBe(3);
    expect(r.unverifiedCount).toBe(3);
    expect(r.verdict).toBe("partial"); // 70% supported, 30% unverified → not verified
  });

  it("returns unverified when half or more findings cannot be settled", async () => {
    const b = brief(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const r = await verifyResearchBrief(b, {
      tier1Judge: async (f: KeyFinding) =>
        ["a", "b", "c"].includes(f.finding)
          ? { support: "cant-tell", evidence: "" }
          : { support: "supported", evidence: "ok" },
      tier2Judge: async () => ({ verdict: "unverified", evidence: "" }),
      maxEscalationRate: 0.31,
      // push unverified to 50% via a second knob: mark 2 more unsupported at tier 1
    });
    // 3 unverified of 10 → partial; now check the ≥50% gate directly with 5 escalations
    const b2 = brief(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const r2 = await verifyResearchBrief(b2, {
      tier1Judge: async (f: KeyFinding) =>
        ["a", "b", "c", "d", "e"].includes(f.finding)
          ? { support: "cant-tell", evidence: "" }
          : { support: "supported", evidence: "ok" },
      tier2Judge: async () => ({ verdict: "unverified", evidence: "" }),
      maxEscalationRate: 0.5,
    });
    expect(r.verdict).toBe("partial");
    expect(r2.verdict).toBe("unverified");
  });

  it("tier-1 timeout escalates instead of failing", async () => {
    const b = brief(["slow", "fast1", "fast2", "fast3"]);
    const r = await verifyResearchBrief(b, {
      tier1Judge: (f: KeyFinding) =>
        f.finding === "slow"
          ? new Promise(() => {})
          : Promise.resolve({ support: "supported" as const, evidence: "ok" }),
      tier2Judge: async () => ({ verdict: "supported", evidence: "settled live" }),
      tier1TimeoutMs: 50,
    });
    expect(r.verdict).toBe("verified");
    expect(r.perFinding.find((f) => f.finding.finding === "slow")?.tier).toBe(2);
  });
});
