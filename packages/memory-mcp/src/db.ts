import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveDbPath(): string {
  const envPath = process.env["CLAUDEMAX_DB"];
  if (envPath && envPath.trim().length > 0) return envPath;
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  return join(projectDir, ".claudemax", "memory.sqlite");
}

export interface ReadonlyDb {
  readonly path: string;
  readonly db: Database.Database;
}

export class MemoryDbMissingError extends Error {
  constructor(public readonly path: string) {
    super(`memory db not found at ${path}; nothing grounded yet`);
    this.name = "MemoryDbMissingError";
  }
}

// Opens a raw read-only better-sqlite3 handle. The writeable MemoryStore class
// is intentionally NOT used: its constructor does mkdir + WAL pragma + exec(SCHEMA)
// + migrate(), all writes that throw on a readonly handle. The MCP runs the SAME
// shared SELECT constants (from @claudemax/memory grounding-queries) against this
// handle. better-sqlite3 ignores fileMustExist when readonly:true, so the file is
// checked first and a typed error is thrown when absent (callers fail-soft).
export function openReadOnlyDb(path: string = resolveDbPath()): ReadonlyDb {
  if (!existsSync(path)) throw new MemoryDbMissingError(path);
  const db = new Database(path, { readonly: true });
  return { path, db };
}
