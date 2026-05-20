import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/index.js";

function freshStore(): { store: MemoryStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cmax-memory-v2-"));
  const store = new MemoryStore({ path: join(dir, "test.sqlite") });
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("MemoryStore v0.2 extensions", () => {
  it("records research_sources and finds them via FTS", () => {
    const { store, cleanup } = freshStore();
    try {
      store.recordResearchSource({
        topic: "agent teams 2026",
        url: "https://www.anthropic.com/engineering/building-c-compiler",
        title: "Building a C compiler with parallel Claudes",
        publishedAt: "2026-04-15",
        relevance: 0.95,
        excerpt: "16 agents coordinated via shared task list...",
      });
      const hits = store.search("agent teams");
      expect(hits.some((h) => h.source === "research_sources")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("records taste_history entries", () => {
    const { store, cleanup } = freshStore();
    try {
      store.recordTaste({
        kind: "taste.md",
        body: "We use Sonnet for execution and Opus for verification.",
        source: "cmax taste init",
      });
      const hits = store.search("Sonnet");
      expect(hits.some((h) => h.source === "taste_history")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("records sub_specs with run_id linkage", () => {
    const { store, cleanup } = freshStore();
    try {
      const runId = store.recordRun({
        specTitle: "Auth migration",
        goal: "Move sessions to passkeys",
        status: "finished",
        costUsd: 5.5,
        tokensIn: 100_000,
        tokensOut: 20_000,
        durationMs: 600_000,
        plan: "max20x",
        mode: "teams",
        evidence: { rollup: "verified" },
      });
      store.recordSubSpec({
        runId,
        subSpecId: "sub-1-authn",
        title: "Webauthn registration",
        status: "finished",
        evidence: { ccAuthnPass: true },
      });
      store.recordSubSpec({
        runId,
        subSpecId: "sub-2-authz",
        title: "Role checks",
        status: "partial",
        evidence: {},
      });
      const hits = store.search("Webauthn");
      expect(hits.some((h) => h.source === "sub_specs")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("creditConsumedThisPeriod sums run cost_usd for current month", () => {
    const { store, cleanup } = freshStore();
    try {
      store.recordRun({
        specTitle: "Run A",
        goal: "a",
        status: "finished",
        costUsd: 3.5,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        evidence: {},
      });
      store.recordRun({
        specTitle: "Run B",
        goal: "b",
        status: "finished",
        costUsd: 2.75,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        evidence: {},
      });
      const total = store.creditConsumedThisPeriod();
      expect(total).toBeCloseTo(6.25, 2);
    } finally {
      cleanup();
    }
  });

  it("recentRuns surfaces plan and mode columns", () => {
    const { store, cleanup } = freshStore();
    try {
      store.recordRun({
        specTitle: "Plan/mode-tagged run",
        goal: "x",
        status: "finished",
        costUsd: 1,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        plan: "max20x",
        mode: "teams",
        evidence: {},
      });
      const runs = store.recentRuns(5);
      expect(runs[0]!.plan).toBe("max20x");
      expect(runs[0]!.mode).toBe("teams");
    } finally {
      cleanup();
    }
  });
});
