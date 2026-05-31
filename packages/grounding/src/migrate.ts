import { join } from "node:path";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";

// DB path resolution mirrors the rest of the harness: CLAUDEMAX_DB env wins,
// else .claudemax/memory.sqlite under CLAUDE_PROJECT_DIR (or cwd).
export function resolveDbPath(): string {
  const env = process.env["CLAUDEMAX_DB"];
  if (env && env.trim()) return env;
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  return join(root, ".claudemax", "memory.sqlite");
}

export interface MigrateResult {
  readonly path: string;
  readonly hasProjectFacts: boolean;
  readonly decisionColumns: readonly string[];
}

// Idempotent. Instantiating MemoryStore runs SCHEMA_SQL (creates project_facts)
// then migrate() (adds the new decisions columns). We do NOT duplicate the DDL
// here — the store owns it. After it runs we read back PRAGMA table_info so the
// caller can confirm what landed without re-opening a writeable handle.
export function migrate(dbPath: string = resolveDbPath()): MigrateResult {
  const store = new MemoryStore({ path: dbPath });
  store.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const factTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='project_facts'`)
      .get() as { name?: string } | undefined;
    const decisionCols = (
      db.prepare(`PRAGMA table_info(decisions)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    return {
      path: dbPath,
      hasProjectFacts: Boolean(factTable?.name),
      decisionColumns: decisionCols,
    };
  } finally {
    db.close();
  }
}
