import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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

  it("recentResearchSourcesForTopic — fuzzy match + age window + limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmax-memory-rrsft-"));
    const dbPath = join(dir, "rrsft.sqlite");
    const store = new MemoryStore({ path: dbPath });
    try {
      // Within window (default 7d), fuzzy topic match: "passkey adoption 2026"
      // matches query "passkey".
      store.recordResearchSource({
        topic: "passkey adoption 2026",
        url: "https://example.com/passkey-1",
        title: "Passkeys mainstream",
        relevance: 0.9,
        excerpt: "passkeys reached majority adoption",
      });
      store.recordResearchSource({
        topic: "PASSKEY browser support",
        url: "https://example.com/passkey-2",
        title: "Browser support matrix",
        relevance: 0.8,
        excerpt: "case-insensitive match should still hit",
      });
      // Older than 7 days — should be filtered out.
      store.recordResearchSource({
        topic: "passkey ancient history",
        url: "https://example.com/passkey-old",
        title: "Old passkey lore",
        relevance: 0.7,
        excerpt: "way out of window",
      });
      // Non-matching topic — should be excluded.
      store.recordResearchSource({
        topic: "anthropic pricing 2026",
        url: "https://example.com/pricing",
        title: "Anthropic pricing",
        relevance: 0.95,
        excerpt: "pricing tiers",
      });

      // Backdate the "ancient" row to 30 days ago. We do this via a sibling
      // connection because the store's db handle is private; this is the
      // standard SQLite pattern for "force a ts" in tests.
      const sibling = new Database(dbPath);
      sibling
        .prepare(
          `UPDATE research_sources
           SET ts = datetime('now', '-30 days')
           WHERE url = ?`,
        )
        .run("https://example.com/passkey-old");
      sibling.close();

      const within = store.recentResearchSourcesForTopic("passkey");
      const urls = within.map((r) => r.url);
      expect(urls).toContain("https://example.com/passkey-1");
      expect(urls).toContain("https://example.com/passkey-2");
      // Older than window — excluded.
      expect(urls).not.toContain("https://example.com/passkey-old");
      // Non-matching topic — excluded.
      expect(urls).not.toContain("https://example.com/pricing");

      // limit is honored.
      const capped = store.recentResearchSourcesForTopic("passkey", 7, 1);
      expect(capped.length).toBe(1);

      // Defaults: maxAgeDays=7, limit=12 — old row stays excluded.
      const defaults = store.recentResearchSourcesForTopic("passkey");
      expect(defaults.every((r) => r.url !== "https://example.com/passkey-old")).toBe(true);

      // Widening the window to 60d includes the old row.
      const wide = store.recentResearchSourcesForTopic("passkey", 60);
      expect(wide.map((r) => r.url)).toContain("https://example.com/passkey-old");

      // Order: DESC by ts. Newest insertion first.
      const ordered = store.recentResearchSourcesForTopic("passkey", 60);
      const oldIdx = ordered.findIndex((r) => r.url === "https://example.com/passkey-old");
      const freshIdx = ordered.findIndex((r) => r.url === "https://example.com/passkey-1");
      expect(oldIdx).toBeGreaterThan(freshIdx);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
