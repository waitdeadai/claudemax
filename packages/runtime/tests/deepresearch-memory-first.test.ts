import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the Anthropic Agent SDK before importing the module under test so that
// deepResearch's `query()` call is intercepted and never hits the network.
// We capture every options object the SDK was called with so the test can
// assert on the user prompt that was actually sent.
const sdkCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  return {
    query: (opts: Record<string, unknown>) => {
      sdkCalls.push(opts);
      return (async function* () {
        // Mimic the v0.3.145+ json_schema result-message shape.
        yield {
          type: "result",
          structured_output: {
            topic: "deepresearch memory-first SOTA 2026",
            summary: "mocked summary",
            keyFindings: [
              {
                finding: "memory-first retrieval reduces token spend on repeats",
                sourceUrls: ["https://example.test/a"],
              },
            ],
            sources: [
              {
                url: "https://example.test/a",
                title: "Example A",
                accessedAt: "2026-05-23",
                relevance: 0.92,
                excerpt: "mocked excerpt",
              },
            ],
            openQuestions: [],
          },
        };
      })();
    },
  };
});

import { MemoryStore } from "@claudemax/memory";
import { deepResearch } from "../src/deepresearch.js";

const TOPIC = "deepresearch memory-first SOTA 2026";

function makeStore(dir: string): MemoryStore {
  return new MemoryStore({ path: join(dir, "memory.sqlite") });
}

describe("deepResearch — memory-first behavior (P1)", () => {
  let workdir: string;

  beforeEach(() => {
    sdkCalls.length = 0;
    workdir = mkdtempSync(join(tmpdir(), "cmax-dr-memfirst-"));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("seeds PRIOR RESEARCH header into the prompt when memory has matching rows", async () => {
    const store = makeStore(workdir);
    store.recordResearchSource({
      topic: TOPIC,
      url: "https://prior.test/ledgered",
      title: "Prior ledger source",
      publishedAt: "2026-05-22",
      relevance: 0.88,
      excerpt: "previously-cached evidence about memory-first retrieval",
    });
    store.close();

    const brief = await deepResearch(TOPIC, {
      cwd: workdir,
      memoryPath: join(workdir, "memory.sqlite"),
      currentDateIso: "2026-05-23T00:00:00.000Z",
    });

    expect(sdkCalls).toHaveLength(1);
    const prompt = String(sdkCalls[0]?.["prompt"] ?? "");
    expect(prompt).toContain("PRIOR RESEARCH");
    expect(prompt).toContain("https://prior.test/ledgered");
    expect(prompt).toContain("Prior ledger source");

    // Brief shape: each keyFinding is the {finding, sourceUrls} object.
    expect(brief.keyFindings.length).toBeGreaterThan(0);
    const first = brief.keyFindings[0]!;
    expect(typeof first.finding).toBe("string");
    expect(Array.isArray(first.sourceUrls)).toBe(true);
    expect(first.sourceUrls.length).toBeGreaterThanOrEqual(1);
  });

  it("emits no PRIOR RESEARCH preamble when no matches exist (fresh query runs alone)", async () => {
    const store = makeStore(workdir);
    // Seed an unrelated topic so the file exists but LOWER-LIKE finds nothing.
    store.recordResearchSource({
      topic: "completely unrelated topic about gardening",
      url: "https://other.test/unrelated",
      title: "Unrelated source",
      relevance: 0.5,
      excerpt: "nothing to do with the query",
    });
    store.close();

    const brief = await deepResearch(TOPIC, {
      cwd: workdir,
      memoryPath: join(workdir, "memory.sqlite"),
      currentDateIso: "2026-05-23T00:00:00.000Z",
    });

    expect(sdkCalls).toHaveLength(1);
    const prompt = String(sdkCalls[0]?.["prompt"] ?? "");
    expect(prompt).not.toContain("PRIOR RESEARCH");
    expect(prompt).not.toContain("memory ledger");
    expect(prompt).not.toContain("https://other.test/unrelated");
    // Fresh-query path: prompt is just the Topic line + JSON instruction.
    expect(prompt.startsWith(`Topic: ${TOPIC}`)).toBe(true);
    expect(brief.topic).toBe(TOPIC);
  });

  it("does not consult the ledger when memoryFirst:false", async () => {
    const store = makeStore(workdir);
    store.recordResearchSource({
      topic: TOPIC,
      url: "https://prior.test/should-not-appear",
      title: "Would have been seeded",
      publishedAt: "2026-05-22",
      relevance: 0.99,
      excerpt: "this row exists but must not be read",
    });
    store.close();

    const ledgerSpy = vi.spyOn(MemoryStore.prototype, "recentResearchSourcesForTopic");

    const brief = await deepResearch(TOPIC, {
      cwd: workdir,
      memoryPath: join(workdir, "memory.sqlite"),
      memoryFirst: false,
      currentDateIso: "2026-05-23T00:00:00.000Z",
    });

    expect(ledgerSpy).not.toHaveBeenCalled();
    const prompt = String(sdkCalls[0]?.["prompt"] ?? "");
    expect(prompt).not.toContain("PRIOR RESEARCH");
    expect(prompt).not.toContain("https://prior.test/should-not-appear");
    expect(prompt).not.toContain("Would have been seeded");
    expect(brief.topic).toBe(TOPIC);
  });
});
