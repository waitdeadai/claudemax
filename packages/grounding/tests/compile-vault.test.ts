import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { compileVault } from "../src/compile-vault.js";

interface Fixture {
  readonly dir: string;
  readonly dbPath: string;
  readonly vaultDir: string;
  readonly cleanup: () => void;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "cmax-grounding-vault-"));
  const dbPath = join(dir, ".claudemax", "memory.sqlite");
  const vaultDir = join(dir, "vault");
  mkdirSync(join(vaultDir, "decisions"), { recursive: true });
  mkdirSync(join(vaultDir, "facts"), { recursive: true });
  return {
    dir,
    dbPath,
    vaultDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function writeNote(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}

describe("compileVault blessed gate", () => {
  it("promotes only blessed:true notes to status='accepted'", () => {
    const f = fixture();
    try {
      writeNote(
        join(f.vaultDir, "decisions", "blessed-one.md"),
        [
          "---",
          "kind: decision",
          "slug: blessed-one",
          "title: A blessed decision",
          "decision: We do the blessed thing.",
          "rationale: Because it is blessed.",
          "blessed: true",
          "invariant: true",
          "scope: '**'",
          "tags: [a, b]",
          "---",
          "body text",
        ].join("\n"),
      );
      writeNote(
        join(f.vaultDir, "decisions", "unblessed.md"),
        [
          "---",
          "kind: decision",
          "slug: unblessed",
          "title: Not blessed",
          "decision: Should be skipped.",
          "blessed: false",
          "---",
          "body",
        ].join("\n"),
      );
      writeNote(
        join(f.vaultDir, "facts", "a-fact.md"),
        [
          "---",
          "kind: fact",
          "key: db.tool",
          "value: drizzle-kit only",
          "blessed: true",
          "invariant: true",
          "scope: '**'",
          "confidence: 5",
          "---",
          "fact body",
        ].join("\n"),
      );

      const result = compileVault({ dbPath: f.dbPath, vaultDir: f.vaultDir });
      expect(result.decisionsAccepted).toBe(1);
      expect(result.factsAccepted).toBe(1);
      expect(result.skipped).toBe(1);

      const db = new Database(f.dbPath, { readonly: true });
      try {
        const accepted = db
          .prepare(`SELECT slug, status, invariant, source_path FROM decisions WHERE status='accepted'`)
          .all() as Array<{ slug: string; status: string; invariant: number; source_path: string | null }>;
        expect(accepted).toHaveLength(1);
        expect(accepted[0]?.slug).toBe("blessed-one");
        expect(accepted[0]?.invariant).toBe(1);
        expect(accepted[0]?.source_path).toContain("blessed-one.md");

        const unblessed = db
          .prepare(`SELECT COUNT(*) AS n FROM decisions WHERE slug='unblessed'`)
          .get() as { n: number };
        expect(unblessed.n).toBe(0);

        const fact = db
          .prepare(`SELECT key, value, status, confidence FROM project_facts`)
          .get() as { key: string; value: string; status: string; confidence: number };
        expect(fact.key).toBe("db.tool");
        expect(fact.status).toBe("accepted");
        expect(fact.confidence).toBe(5);
      } finally {
        db.close();
      }
    } finally {
      f.cleanup();
    }
  });

  it("upserts by slug on re-compile (no duplicate accepted rows)", () => {
    const f = fixture();
    try {
      const notePath = join(f.vaultDir, "decisions", "stable.md");
      writeNote(
        notePath,
        [
          "---",
          "kind: decision",
          "slug: stable",
          "title: First title",
          "decision: First decision.",
          "blessed: true",
          "scope: '**'",
          "---",
          "",
        ].join("\n"),
      );
      compileVault({ dbPath: f.dbPath, vaultDir: f.vaultDir });

      writeNote(
        notePath,
        [
          "---",
          "kind: decision",
          "slug: stable",
          "title: Updated title",
          "decision: Updated decision.",
          "blessed: true",
          "scope: '**'",
          "---",
          "",
        ].join("\n"),
      );
      compileVault({ dbPath: f.dbPath, vaultDir: f.vaultDir });

      const db = new Database(f.dbPath, { readonly: true });
      try {
        const rows = db
          .prepare(`SELECT topic FROM decisions WHERE slug='stable' AND status='accepted'`)
          .all() as Array<{ topic: string }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.topic).toBe("Updated title");
      } finally {
        db.close();
      }
    } finally {
      f.cleanup();
    }
  });

  it("marks the prior slug superseded when supersedes is set", () => {
    const f = fixture();
    try {
      writeNote(
        join(f.vaultDir, "decisions", "old.md"),
        [
          "---",
          "kind: decision",
          "slug: old-way",
          "title: Old way",
          "decision: The old approach.",
          "blessed: true",
          "scope: '**'",
          "---",
          "",
        ].join("\n"),
      );
      writeNote(
        join(f.vaultDir, "decisions", "new.md"),
        [
          "---",
          "kind: decision",
          "slug: new-way",
          "title: New way",
          "decision: The new approach.",
          "blessed: true",
          "scope: '**'",
          "supersedes: old-way",
          "---",
          "",
        ].join("\n"),
      );
      const result = compileVault({ dbPath: f.dbPath, vaultDir: f.vaultDir });
      expect(result.superseded).toBe(1);

      const db = new Database(f.dbPath, { readonly: true });
      try {
        const old = db
          .prepare(`SELECT status FROM decisions WHERE slug='old-way'`)
          .get() as { status: string };
        expect(old.status).toBe("superseded");
      } finally {
        db.close();
      }
    } finally {
      f.cleanup();
    }
  });
});
