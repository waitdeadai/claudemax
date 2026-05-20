import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/index.js";

describe("MemoryStore", () => {
  it("round-trips episodes, decisions, runs and finds them via FTS", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmax-memory-"));
    const store = new MemoryStore({ path: join(dir, "test.sqlite") });
    try {
      store.recordEpisode({
        kind: "goal-run",
        title: "auth migration",
        body: "moved sessions to passkeys, all tests passing",
      });
      store.recordDecision({
        topic: "auth",
        decision: "use webauthn",
        rationale: "passkey ecosystem is mature in 2026",
      });
      store.recordRun({
        specTitle: "auth migration",
        goal: "move to passkeys",
        status: "finished",
        costUsd: 4.2,
        tokensIn: 50_000,
        tokensOut: 12_000,
        durationMs: 120_000,
        evidence: { "cc-1": "tests pass" },
      });

      const hits = store.search("passkey");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.source === "episodes")).toBe(true);
      expect(hits.some((h) => h.source === "decisions")).toBe(true);

      const runs = store.recentRuns(5);
      expect(runs.length).toBe(1);
      expect(runs[0]!.status).toBe("finished");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
