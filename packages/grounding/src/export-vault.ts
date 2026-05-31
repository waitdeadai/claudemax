import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";
import { serializeNote, type FrontmatterValue } from "./frontmatter.js";
import { resolveDbPath } from "./migrate.js";

export interface ExportVaultOptions {
  readonly dbPath?: string;
  readonly vaultDir?: string;
}

export interface ExportVaultResult {
  readonly written: readonly string[];
}

// Surface proposed rows that have no vault provenance yet (agent-appended via
// `cmax memory propose-*`) into vault/_inbox/ as blessed:false notes. This is
// the human review queue. Never auto-bless. Rows that already round-trip from a
// vault note (source_path set) are not re-exported.
export function exportVault(opts: ExportVaultOptions = {}): ExportVaultResult {
  const dbPath = opts.dbPath ?? resolveDbPath();
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  const inboxDir = opts.vaultDir
    ? join(opts.vaultDir, "_inbox")
    : join(root, "vault", "_inbox");

  const store = new MemoryStore({ path: dbPath });
  store.close();

  if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

  const db = new Database(dbPath, { readonly: true });
  const written: string[] = [];
  try {
    const decisions = db
      .prepare(
        `SELECT id, slug, topic, decision, rationale, scope, invariant, ttl_days, tags
         FROM decisions
         WHERE status = 'proposed' AND source_path IS NULL
         ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      slug: string | null;
      topic: string;
      decision: string;
      rationale: string;
      scope: string | null;
      invariant: number;
      ttl_days: number | null;
      tags: string | null;
    }>;

    for (const d of decisions) {
      const slug = d.slug ?? `decision-${d.id}`;
      const data: Record<string, FrontmatterValue> = {
        kind: "decision",
        slug,
        title: d.topic,
        decision: d.decision,
        rationale: d.rationale,
        status: "proposed",
        blessed: false,
        invariant: d.invariant === 1,
        scope: d.scope ?? "**",
      };
      if (d.ttl_days !== null) data["ttl_days"] = d.ttl_days;
      const tags = csvToTags(d.tags);
      if (tags) data["tags"] = tags;
      const path = join(inboxDir, `${safeName(slug)}.md`);
      writeFileSync(path, serializeNote(data, d.rationale || d.decision), "utf8");
      written.push(path);
    }

    const facts = db
      .prepare(
        `SELECT id, key, value, scope, invariant, confidence, source, ttl_days, tags
         FROM project_facts
         WHERE status = 'proposed' AND source_path IS NULL
         ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      key: string;
      value: string;
      scope: string | null;
      invariant: number;
      confidence: number;
      source: string | null;
      ttl_days: number | null;
      tags: string | null;
    }>;

    for (const f of facts) {
      const data: Record<string, FrontmatterValue> = {
        kind: "fact",
        key: f.key,
        value: f.value,
        status: "proposed",
        blessed: false,
        invariant: f.invariant === 1,
        scope: f.scope ?? "**",
        confidence: f.confidence,
      };
      if (f.source) data["source"] = f.source;
      if (f.ttl_days !== null) data["ttl_days"] = f.ttl_days;
      const tags = csvToTags(f.tags);
      if (tags) data["tags"] = tags;
      const path = join(inboxDir, `${safeName(f.key)}.md`);
      writeFileSync(path, serializeNote(data, f.value), "utf8");
      written.push(path);
    }

    return { written };
  } finally {
    db.close();
  }
}

function csvToTags(csv: string | null): readonly string[] | null {
  if (!csv) return null;
  const tags = csv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : null;
}

function safeName(addressable: string): string {
  const cleaned = addressable.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "untitled";
}
