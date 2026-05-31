// Regression test for the "no such column: agent_id" / "no such column: lane_id"
// bug. SCHEMA_SQL used to include CREATE INDEX statements referencing columns
// added later via migrate(); on existing DBs whose CREATE TABLE IF NOT EXISTS
// short-circuited, the indexes failed before migrate() could add the columns.
// This test reproduces the failure by seeding an old-schema DB and asserting
// that opening a MemoryStore on it migrates cleanly.

import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { MemoryStore } from "./store.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cmax-memstore-"));
  tmpDirs.push(d);
  return d;
}

// Old-schema runs table: NO agent_id, parent_agent_id, lane_id, run_id,
// user_id, app_id, last_verified_at, verified_count. Mirrors what someone's
// DB looked like before the SOTA-2026 memory bump.
const LEGACY_RUNS_SQL = `
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  spec_title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  mode TEXT,
  evidence_json TEXT
);
`;

const LEGACY_OTHER_TABLES_SQL = `
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  meta_json TEXT
);
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL
);
CREATE TABLE errors_solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signature TEXT NOT NULL,
  error TEXT NOT NULL,
  solution TEXT NOT NULL,
  context TEXT
);
CREATE TABLE patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
`;

describe("MemoryStore — legacy-schema migration", () => {
  it("opens cleanly on a DB whose runs table predates agent_id/lane_id columns", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");

    // Seed old-schema DB
    const seed = new Database(dbPath);
    seed.exec(LEGACY_RUNS_SQL);
    seed.exec(LEGACY_OTHER_TABLES_SQL);
    seed
      .prepare(
        `INSERT INTO runs (spec_title, goal, status, cost_usd, tokens_in, tokens_out, duration_ms)
         VALUES ('legacy', 'legacy goal', 'finished', 0, 0, 0, 0)`,
      )
      .run();
    seed.close();

    // Open MemoryStore — must NOT throw "no such column: agent_id".
    expect(() => {
      const store = new MemoryStore({ path: dbPath });
      store.close();
    }).not.toThrow();

    // After migrate, the new columns should exist + the legacy row preserved.
    const check = new Database(dbPath);
    const cols = check.pragma("table_info(runs)") as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    for (const required of [
      "agent_id",
      "parent_agent_id",
      "lane_id",
      "run_id",
      "user_id",
      "app_id",
      "last_verified_at",
      "verified_count",
    ]) {
      expect(colNames.has(required), `runs.${required} missing after migrate`).toBe(true);
    }
    const surviving = check.prepare(`SELECT spec_title FROM runs`).get() as
      | { spec_title: string }
      | undefined;
    expect(surviving?.spec_title).toBe("legacy");
    check.close();
  });

  it("opens cleanly on a fresh DB (no migration needed)", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    expect(() => {
      const store = new MemoryStore({ path: dbPath });
      store.close();
    }).not.toThrow();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("is idempotent — opening twice does not throw", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const s1 = new MemoryStore({ path: dbPath });
    s1.close();
    expect(() => {
      const s2 = new MemoryStore({ path: dbPath });
      s2.close();
    }).not.toThrow();
  });
});

describe("MemoryStore — grounding schema + columns", () => {
  it("adds the seven grounding columns to a legacy decisions table", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");

    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL
      );
    `);
    seed
      .prepare(`INSERT INTO decisions (topic, decision, rationale) VALUES ('legacy', 'd', 'r')`)
      .run();
    seed.close();

    expect(() => {
      const store = new MemoryStore({ path: dbPath });
      store.close();
    }).not.toThrow();

    const check = new Database(dbPath);
    const cols = check.pragma("table_info(decisions)") as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const required of [
      "slug",
      "status",
      "scope",
      "invariant",
      "ttl_days",
      "source_path",
      "tags",
    ]) {
      expect(names.has(required), `decisions.${required} missing after migrate`).toBe(true);
    }
    const legacy = check.prepare(`SELECT topic FROM decisions`).get() as
      | { topic: string }
      | undefined;
    expect(legacy?.topic).toBe("legacy");
    check.close();
  });

  it("creates project_facts on a fresh DB", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.close();

    const check = new Database(dbPath);
    const cols = check.pragma("table_info(project_facts)") as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const required of [
      "key",
      "value",
      "scope",
      "status",
      "invariant",
      "confidence",
      "source",
      "source_path",
      "tags",
      "ttl_days",
      "last_verified_at",
      "verified_count",
    ]) {
      expect(names.has(required), `project_facts.${required} missing`).toBe(true);
    }
    check.close();
  });
});

describe("MemoryStore — grounding read methods", () => {
  function accept(dbPath: string, sql: string): void {
    const db = new Database(dbPath);
    db.exec(sql);
    db.close();
  }

  it("getDecisionBySlug returns only accepted, with stale flag computed", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.proposeDecision({ slug: "anthropic-only", title: "t", decision: "d", invariant: true });
    store.close();

    const before = new MemoryStore({ path: dbPath });
    expect(before.getDecisionBySlug("anthropic-only")).toBeNull();
    before.close();

    accept(
      dbPath,
      `UPDATE decisions SET status='accepted', last_verified_at=datetime('now') WHERE slug='anthropic-only'`,
    );

    const after = new MemoryStore({ path: dbPath });
    const row = after.getDecisionBySlug("anthropic-only");
    expect(row).not.toBeNull();
    expect(row?.slug).toBe("anthropic-only");
    expect(row?.invariant).toBe(true);
    expect(row?.stale).toBe(false);
    expect(after.getDecisionBySlug("does-not-exist")).toBeNull();
    after.close();
  });

  it("getFact picks the most-specific matching scope", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.proposeFact({ key: "db.tool", value: "global default", scope: "**" });
    store.proposeFact({ key: "db.tool", value: "auth-specific", scope: "packages/auth/**" });
    store.close();

    accept(
      dbPath,
      `UPDATE project_facts SET status='accepted', last_verified_at=datetime('now')`,
    );

    const s = new MemoryStore({ path: dbPath });

    const inAuth = s.getFact("db.tool", "packages/auth/login.ts");
    expect(inAuth?.value).toBe("auth-specific");

    const elsewhere = s.getFact("db.tool", "packages/cli/index.ts");
    expect(elsewhere?.value).toBe("global default");

    const noScope = s.getFact("db.tool");
    expect(noScope?.value).toBe("global default");

    expect(s.getFact("missing.key")).toBeNull();
    s.close();
  });

  it("staleTruth returns accepted invariant rows past their window only", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.proposeDecision({ slug: "old-invariant", title: "t", decision: "d", invariant: true });
    store.proposeDecision({ slug: "fresh-invariant", title: "t", decision: "d", invariant: true });
    store.proposeFact({ key: "stale.fact", value: "v", invariant: true, ttlDays: 7 });
    store.proposeFact({ key: "non.invariant", value: "v", invariant: false });
    store.close();

    accept(
      dbPath,
      `
      UPDATE decisions SET status='accepted', last_verified_at=datetime('now','-90 days') WHERE slug='old-invariant';
      UPDATE decisions SET status='accepted', last_verified_at=datetime('now') WHERE slug='fresh-invariant';
      UPDATE project_facts SET status='accepted', last_verified_at=datetime('now','-30 days') WHERE key='stale.fact';
      UPDATE project_facts SET status='accepted', last_verified_at=datetime('now','-365 days') WHERE key='non.invariant';
      `,
    );

    const s = new MemoryStore({ path: dbPath });
    const stale = s.staleTruth();
    const refs = stale.map((r) => r.addressable).sort();
    expect(refs).toContain("old-invariant");
    expect(refs).toContain("stale.fact");
    expect(refs).not.toContain("fresh-invariant");
    expect(refs).not.toContain("non.invariant");
    for (const row of stale) {
      expect(row.ageDays).toBeGreaterThan(row.ttlDays);
      expect(row.ref).toMatch(/^(decisions|project_facts)#\d+$/);
    }
    s.close();
  });

  it("searchGrounding returns scoped FTS hits with age/stale enrichment", () => {
    const dir = makeTmp();
    const dbPath = join(dir, "memory.sqlite");
    const store = new MemoryStore({ path: dbPath });
    store.proposeFact({
      key: "auth.provider",
      value: "anthropic subscription via query()",
      scope: "**",
    });
    store.proposeDecision({
      slug: "multispec-default",
      title: "multispec is the default pipeline",
      decision: "every umbrella auto-runs deepresearch multispec parallel goal verify",
    });
    store.close();

    accept(dbPath, `UPDATE project_facts SET status='accepted', last_verified_at=datetime('now')`);

    const s = new MemoryStore({ path: dbPath });
    const hits = s.searchGrounding("multispec", "decision", undefined, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.source).toBe("decisions");

    const factHits = s.searchGrounding("anthropic", "fact");
    expect(factHits.some((h) => h.source === "project_facts")).toBe(true);

    const capped = s.searchGrounding("anthropic", "all", undefined, 1);
    expect(capped.length).toBeLessThanOrEqual(1);
    s.close();
  });
});
