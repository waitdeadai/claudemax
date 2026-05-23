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
