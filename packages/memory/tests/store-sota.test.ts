import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, defaultQueuePath } from "../src/index.js";

function freshStore(): { store: MemoryStore; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cmax-memory-sota-"));
  const store = new MemoryStore({ path: join(dir, "test.sqlite") });
  return {
    store,
    dir,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("MemoryStore SOTA-2026 surface", () => {
  it("add+recall round-trip surfaces inserted decision via hybrid scorer", () => {
    const { store, cleanup } = freshStore();
    try {
      const result = store.add(
        "decision",
        "use opus 4.7 for verification",
        "Verifier blind-reads spec at confidence 0.85; Opus catches Sonnet drift.",
        { laneId: "infra", runId: "run-1" },
      );
      expect(result.source).toBe("decisions");
      const hits = store.recall("verification opus");
      expect(hits.length).toBeGreaterThan(0);
      const top = hits[0]!;
      expect(top.source).toBe("decisions");
      expect(top.rowidRef).toBe(result.rowidRef);
      expect(top.laneId).toBe("infra");
      expect(top.runId).toBe("run-1");
      expect(top.stale).toBe(false);
      expect(top.verifiedCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("recall respects lane scope filter", () => {
    const { store, cleanup } = freshStore();
    try {
      store.add("pattern", "lane-A pattern", "body alpha", { laneId: "lane-A" });
      store.add("pattern", "lane-B pattern", "body beta", { laneId: "lane-B" });
      const hits = store.recall("pattern", { scope: { laneId: "lane-A" } });
      expect(hits.length).toBe(1);
      expect(hits[0]!.laneId).toBe("lane-A");
    } finally {
      cleanup();
    }
  });

  it("markVerified bumps verified_count and refreshes last_verified_at", () => {
    const { store, cleanup } = freshStore();
    try {
      const { source, rowidRef } = store.add(
        "error-solution",
        "TS2345 at adapter.ts:454",
        "Fix: align arg type with adapter signature.",
      );
      const before = store.recall("TS2345 adapter")[0]!;
      expect(before.verifiedCount).toBe(1);
      const ok = store.markVerified(source, rowidRef, "test-agent");
      expect(ok).toBe(true);
      const after = store.recall("TS2345 adapter")[0]!;
      expect(after.verifiedCount).toBe(2);
      expect(after.lastVerifiedAt).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("drainQueue consumes JSONL envelopes into SQLite", () => {
    const { store, dir, cleanup } = freshStore();
    try {
      const queuePath = defaultQueuePath(dir);
      store.enqueueWrite(queuePath, {
        tier: "episode",
        title: "queued episode",
        body: "queued body",
        ts: new Date().toISOString(),
        scope: { laneId: "queued-lane" },
      });
      store.enqueueWrite(queuePath, {
        tier: "decision",
        title: "queued decision",
        body: "rationale",
        ts: new Date().toISOString(),
      });
      const n = store.drainQueue(queuePath);
      expect(n).toBe(2);
      const ep = store.recall("queued episode");
      expect(ep[0]!.source).toBe("episodes");
      expect(ep[0]!.laneId).toBe("queued-lane");
    } finally {
      cleanup();
    }
  });

  it("recall returns empty for stop-word-only queries instead of crashing FTS", () => {
    const { store, cleanup } = freshStore();
    try {
      store.add("episode", "real content", "body");
      // single-char / punctuation-only query — sanitizer should return ""
      const hits = store.recall("? !");
      expect(hits).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
