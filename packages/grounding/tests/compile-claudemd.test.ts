import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";
import { compileClaudeMd } from "../src/compile-claudemd.js";

interface Fixture {
  readonly dir: string;
  readonly dbPath: string;
  readonly cleanup: () => void;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "cmax-grounding-claudemd-"));
  const dbPath = join(dir, ".claudemax", "memory.sqlite");
  return {
    dir,
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function seedInvariants(dbPath: string): void {
  const store = new MemoryStore({ path: dbPath });
  store.close();
  const db = new Database(dbPath);
  try {
    db.prepare(
      `INSERT INTO decisions (topic, decision, rationale, slug, status, scope, invariant, last_verified_at, verified_count)
       VALUES (?, ?, ?, ?, 'accepted', '**', 1, '2026-05-31', 1)`,
    ).run("Anthropic-only by design", "All calls via query()", "subscription-first", "anthropic-only");
    db.prepare(
      `INSERT INTO project_facts (key, value, scope, status, invariant, confidence, last_verified_at, verified_count)
       VALUES (?, ?, '**', 'accepted', 1, 5, '2026-05-31', 1)`,
    ).run("auth.provider.sdk", "subscription-first via query()");
    db.prepare(
      `INSERT INTO decisions (topic, decision, rationale, slug, status, scope, invariant, last_verified_at, verified_count)
       VALUES (?, ?, ?, ?, 'proposed', '**', 1, '2026-05-31', 0)`,
    ).run("Not accepted yet", "should be excluded", "rationale", "proposed-one");
  } finally {
    db.close();
  }
}

describe("compileClaudeMd managed block", () => {
  it("writes a GROUNDING block with only accepted invariant rows", () => {
    const f = fixture();
    try {
      seedInvariants(f.dbPath);
      writeFileSync(join(f.dir, "CLAUDE.md"), "# Hand-written prose\n\nKeep me.\n", "utf8");

      const result = compileClaudeMd({ dbPath: f.dbPath, rootDir: f.dir });
      expect(result.invariantsByScope["**"]).toBe(2);

      const content = readFileSync(join(f.dir, "CLAUDE.md"), "utf8");
      expect(content).toContain("# Hand-written prose");
      expect(content).toContain("Keep me.");
      expect(content).toContain("<!-- GROUNDING:BEGIN");
      expect(content).toContain("<!-- GROUNDING:END -->");
      expect(content).toContain("anthropic-only");
      expect(content).toContain("auth.provider.sdk");
      expect(content).not.toContain("should be excluded");
    } finally {
      f.cleanup();
    }
  });

  it("is idempotent — running twice yields an identical managed block", () => {
    const f = fixture();
    try {
      seedInvariants(f.dbPath);
      const target = join(f.dir, "CLAUDE.md");
      writeFileSync(target, "# Header\n\nprose\n", "utf8");

      compileClaudeMd({ dbPath: f.dbPath, rootDir: f.dir });
      const first = readFileSync(target, "utf8");

      compileClaudeMd({ dbPath: f.dbPath, rootDir: f.dir });
      const second = readFileSync(target, "utf8");

      expect(second).toBe(first);
      const beginCount = (second.match(/<!-- GROUNDING:BEGIN/g) ?? []).length;
      const endCount = (second.match(/<!-- GROUNDING:END -->/g) ?? []).length;
      expect(beginCount).toBe(1);
      expect(endCount).toBe(1);
    } finally {
      f.cleanup();
    }
  });

  it("appends a fresh block at EOF when no markers exist, preserving prose", () => {
    const f = fixture();
    try {
      seedInvariants(f.dbPath);
      const target = join(f.dir, "CLAUDE.md");
      writeFileSync(target, "# Only prose, no markers\n", "utf8");

      compileClaudeMd({ dbPath: f.dbPath, rootDir: f.dir });
      const content = readFileSync(target, "utf8");
      expect(content.startsWith("# Only prose, no markers")).toBe(true);
      expect(content).toContain("<!-- GROUNDING:BEGIN");
    } finally {
      f.cleanup();
    }
  });

  it("creates a scoped CLAUDE.md when the file does not yet exist", () => {
    const f = fixture();
    try {
      const store = new MemoryStore({ path: f.dbPath });
      store.close();
      const db = new Database(f.dbPath);
      try {
        mkdirSync(join(f.dir, "packages", "auth"), { recursive: true });
        db.prepare(
          `INSERT INTO project_facts (key, value, scope, status, invariant, confidence, last_verified_at, verified_count)
           VALUES (?, ?, 'packages/auth/**', 'accepted', 1, 5, '2026-05-31', 1)`,
        ).run("auth.method", "passkeys only");
      } finally {
        db.close();
      }

      const result = compileClaudeMd({ dbPath: f.dbPath, rootDir: f.dir });
      const scoped = join(f.dir, "packages", "auth", "CLAUDE.md");
      expect(result.filesWritten).toContain(scoped);
      const content = readFileSync(scoped, "utf8");
      expect(content).toContain("auth.method");
      expect(content).toContain("passkeys only");
    } finally {
      f.cleanup();
    }
  });
});
