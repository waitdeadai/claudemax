import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";
import { openReadOnlyDb, resolveDbPath, MemoryDbMissingError } from "../src/db.js";
import { buildServer } from "../src/index.js";
import { getDecision, getFact, searchGrounding, staleTruth } from "../src/queries.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function seededDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "cmax-memmcp-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "memory.sqlite");

  // Seed + bless via the writeable store, then accept (humans bless; the MCP
  // only ever reads accepted rows).
  const store = new MemoryStore({ path: dbPath });
  store.proposeFact({
    key: "auth.provider",
    value: "anthropic subscription via query()",
    scope: "**",
    invariant: true,
  });
  store.proposeDecision({
    slug: "multispec-default",
    title: "multispec is the default pipeline",
    decision: "every umbrella auto-runs deepresearch multispec parallel goal verify",
    invariant: true,
  });
  store.close();

  const db = new Database(dbPath);
  db.exec(
    `UPDATE project_facts SET status='accepted', last_verified_at=datetime('now');
     UPDATE decisions SET status='accepted', last_verified_at=datetime('now');`,
  );
  db.close();
  return dbPath;
}

describe("memory-mcp — read-only queries over a seeded db", () => {
  it("openReadOnlyDb returns a handle for an existing db", () => {
    const dbPath = seededDbPath();
    const { db, path } = openReadOnlyDb(dbPath);
    expect(path).toBe(dbPath);
    db.close();
  });

  it("throws MemoryDbMissingError when the db file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmax-memmcp-missing-"));
    tmpDirs.push(dir);
    expect(() => openReadOnlyDb(join(dir, "nope.sqlite"))).toThrow(MemoryDbMissingError);
  });

  it("memory_get_fact returns the seeded fact with age metadata", () => {
    const { db } = openReadOnlyDb(seededDbPath());
    const fact = getFact(db, "auth.provider");
    expect(fact).not.toBeNull();
    expect(fact?.value).toBe("anthropic subscription via query()");
    expect(fact?.ref).toMatch(/^project_facts#\d+$/);
    expect(fact?.ageDays).not.toBeNull();
    expect(typeof fact?.stale).toBe("boolean");
    expect(fact?.stale).toBe(false);
    db.close();
  });

  it("memory_search returns the seeded fact ranked, with age/stale enrichment", () => {
    const { db } = openReadOnlyDb(seededDbPath());
    const hits = searchGrounding(db, "anthropic", "fact");
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits.find((h) => h.source === "project_facts");
    expect(hit).toBeDefined();
    expect(hit?.ref).toMatch(/^project_facts#\d+$/);
    expect(hit?.ageDays).not.toBeNull();
    expect(typeof hit?.stale).toBe("boolean");

    const decisionHits = searchGrounding(db, "multispec", "decision");
    expect(decisionHits.some((h) => h.source === "decisions")).toBe(true);

    const capped = searchGrounding(db, "anthropic", "all", undefined, 1);
    expect(capped.length).toBeLessThanOrEqual(1);
    db.close();
  });

  it("memory_get_decision resolves the seeded slug, only when accepted", () => {
    const { db } = openReadOnlyDb(seededDbPath());
    const d = getDecision(db, "multispec-default");
    expect(d).not.toBeNull();
    expect(d?.slug).toBe("multispec-default");
    expect(d?.invariant).toBe(true);
    expect(getDecision(db, "does-not-exist")).toBeNull();
    db.close();
  });

  it("memory_stale lists invariant rows past their window only", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmax-memmcp-stale-"));
    tmpDirs.push(dir);
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.proposeFact({ key: "stale.fact", value: "v", invariant: true, ttlDays: 7 });
    store.proposeFact({ key: "fresh.fact", value: "v", invariant: true });
    store.close();
    const w = new Database(dbPath);
    w.exec(
      `UPDATE project_facts SET status='accepted', last_verified_at=datetime('now','-30 days') WHERE key='stale.fact';
       UPDATE project_facts SET status='accepted', last_verified_at=datetime('now') WHERE key='fresh.fact';`,
    );
    w.close();

    const { db } = openReadOnlyDb(dbPath);
    const stale = staleTruth(db);
    const keys = stale.map((s) => s.addressable);
    expect(keys).toContain("stale.fact");
    expect(keys).not.toContain("fresh.fact");
    for (const s of stale) {
      expect(s.ageDays).toBeGreaterThan(s.ttlDays);
      expect(s.ref).toMatch(/^project_facts#\d+$/);
    }
    db.close();
  });

  it("buildServer registers without touching the db (lazy handle)", () => {
    const dbPath = seededDbPath();
    let opened = 0;
    const server = buildServer(() => {
      opened += 1;
      return openReadOnlyDb(dbPath).db;
    });
    expect(server).toBeDefined();
    expect(opened).toBe(0);
  });

  it("resolveDbPath honors CLAUDEMAX_DB then falls back to .claudemax", () => {
    const prevDb = process.env["CLAUDEMAX_DB"];
    const prevProj = process.env["CLAUDE_PROJECT_DIR"];
    try {
      process.env["CLAUDEMAX_DB"] = "/tmp/explicit.sqlite";
      expect(resolveDbPath()).toBe("/tmp/explicit.sqlite");
      delete process.env["CLAUDEMAX_DB"];
      process.env["CLAUDE_PROJECT_DIR"] = "/tmp/proj";
      expect(resolveDbPath()).toBe("/tmp/proj/.claudemax/memory.sqlite");
    } finally {
      if (prevDb === undefined) delete process.env["CLAUDEMAX_DB"];
      else process.env["CLAUDEMAX_DB"] = prevDb;
      if (prevProj === undefined) delete process.env["CLAUDE_PROJECT_DIR"];
      else process.env["CLAUDE_PROJECT_DIR"] = prevProj;
    }
  });
});
