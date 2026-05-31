import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";
import { parseFrontmatter, type FrontmatterValue } from "./frontmatter.js";
import { resolveDbPath } from "./migrate.js";

export interface CompileVaultOptions {
  readonly dbPath?: string;
  readonly vaultDir?: string;
}

export interface CompileVaultResult {
  readonly decisionsAccepted: number;
  readonly factsAccepted: number;
  readonly superseded: number;
  readonly skipped: number;
}

interface UpsertContext {
  readonly db: Database.Database;
  readonly today: string;
}

// Promote blessed vault notes into memory.sqlite as status='accepted'. Notes
// that are not blessed:true are skipped (the human-in-the-loop gate). The
// MemoryStore constructor runs first to guarantee schema/migrate; the accepted
// upserts then run through a raw writeable handle (MemoryStore only exposes the
// proposed-status append path, never accept).
export function compileVault(opts: CompileVaultOptions = {}): CompileVaultResult {
  const dbPath = opts.dbPath ?? resolveDbPath();
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  const vaultDir = opts.vaultDir ?? join(root, "vault");

  const store = new MemoryStore({ path: dbPath });
  store.close();

  const db = new Database(dbPath);
  try {
    const ctx: UpsertContext = { db, today: todayIso() };
    let decisionsAccepted = 0;
    let factsAccepted = 0;
    let superseded = 0;
    let skipped = 0;

    // Two-pass for decisions: upsert every blessed decision FIRST so the
    // supersedes pass is independent of file iteration order (the superseded
    // slug may live in a note that compiles after the superseding one).
    const supersedeRequests: Array<{ readonly newId: number; readonly oldSlug: string }> = [];
    for (const { data, body, path } of readNotes(join(vaultDir, "decisions"))) {
      if (data["blessed"] !== true) {
        skipped += 1;
        continue;
      }
      const id = upsertDecision(ctx, data, body, path);
      decisionsAccepted += 1;
      const oldSlug = str(data["supersedes"]);
      const slug = str(data["slug"]);
      if (oldSlug && oldSlug !== slug) {
        supersedeRequests.push({ newId: id, oldSlug });
      }
    }
    for (const req of supersedeRequests) {
      superseded += applySupersede(ctx, req.newId, req.oldSlug);
    }

    for (const { data, body, path } of readNotes(join(vaultDir, "facts"))) {
      if (data["blessed"] !== true) {
        skipped += 1;
        continue;
      }
      upsertFact(ctx, data, body, path);
      factsAccepted += 1;
    }

    return { decisionsAccepted, factsAccepted, superseded, skipped };
  } finally {
    db.close();
  }
}

interface NoteFile {
  readonly data: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
  readonly path: string;
}

function readNotes(dir: string): NoteFile[] {
  if (!existsSync(dir)) return [];
  const notes: NoteFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    if (entry.toLowerCase() === "readme.md") continue;
    const path = join(dir, entry);
    const parsed = parseFrontmatter(readFileSync(path, "utf8"));
    notes.push({ data: parsed.data, body: parsed.body, path });
  }
  return notes;
}

function upsertDecision(
  ctx: UpsertContext,
  data: Readonly<Record<string, FrontmatterValue>>,
  body: string,
  path: string,
): number {
  const slug = str(data["slug"]);
  if (!slug) throw new Error(`vault decision note missing slug: ${path}`);
  const topic = str(data["title"]) || slug;
  const decision = str(data["decision"]) || body;
  const rationale = str(data["rationale"]) || "";
  const scope = str(data["scope"]) || "**";
  const invariant = data["invariant"] === true ? 1 : 0;
  const ttlDays = int(data["ttl_days"]);
  const tags = tagsToCsv(data["tags"]);

  const existing = ctx.db
    .prepare(`SELECT id FROM decisions WHERE slug = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1`)
    .get(slug) as { id: number } | undefined;

  let id: number;
  if (existing) {
    ctx.db
      .prepare(
        `UPDATE decisions SET
           topic = ?, decision = ?, rationale = ?, status = 'accepted',
           scope = ?, invariant = ?, ttl_days = ?, source_path = ?, tags = ?,
           last_verified_at = ?, verified_count = 1
         WHERE id = ?`,
      )
      .run(topic, decision, rationale, scope, invariant, ttlDays, path, tags, ctx.today, existing.id);
    id = existing.id;
  } else {
    const r = ctx.db
      .prepare(
        `INSERT INTO decisions
           (topic, decision, rationale, slug, status, scope, invariant, ttl_days, source_path, tags,
            last_verified_at, verified_count)
         VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(topic, decision, rationale, slug, scope, invariant, ttlDays, path, tags, ctx.today);
    id = Number(r.lastInsertRowid);
  }
  indexFts(ctx.db, "decisions", id, topic, `${decision}\n${rationale}`);
  return id;
}

// Mark the prior slug's accepted/proposed rows superseded, pointing at the new
// decision id. Runs after ALL decisions are upserted so it is order-independent.
function applySupersede(ctx: UpsertContext, newId: number, oldSlug: string): number {
  const r = ctx.db
    .prepare(
      `UPDATE decisions SET status = 'superseded', superseded_by = ?
       WHERE slug = ? AND id != ? AND status != 'superseded'`,
    )
    .run(newId, oldSlug, newId);
  return r.changes;
}

function upsertFact(
  ctx: UpsertContext,
  data: Readonly<Record<string, FrontmatterValue>>,
  body: string,
  path: string,
): number {
  const key = str(data["key"]);
  if (!key) throw new Error(`vault fact note missing key: ${path}`);
  const value = str(data["value"]) || body;
  const scope = str(data["scope"]) || "**";
  const invariant = data["invariant"] === true ? 1 : 0;
  const confidence = clampConfidence(int(data["confidence"]) ?? 3);
  const source = str(data["source"]) || null;
  const ttlDays = int(data["ttl_days"]);
  const tags = tagsToCsv(data["tags"]);

  ctx.db
    .prepare(
      `INSERT INTO project_facts
         (key, value, scope, status, invariant, confidence, source, source_path, tags, ttl_days,
          last_verified_at, verified_count)
       VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(key, scope) DO UPDATE SET
         value = excluded.value,
         status = 'accepted',
         invariant = excluded.invariant,
         confidence = excluded.confidence,
         source = excluded.source,
         source_path = excluded.source_path,
         tags = excluded.tags,
         ttl_days = excluded.ttl_days,
         last_verified_at = excluded.last_verified_at,
         verified_count = 1`,
    )
    .run(key, value, scope, invariant, confidence, source, path, tags, ttlDays, ctx.today);

  const row = ctx.db
    .prepare(`SELECT id FROM project_facts WHERE key = ? AND scope = ?`)
    .get(key, scope) as { id: number } | undefined;
  const id = row?.id ?? 0;
  indexFts(ctx.db, "project_facts", id, key, value);
  return id;
}

function indexFts(
  db: Database.Database,
  source: string,
  rowidRef: number,
  title: string,
  body: string,
): void {
  db.prepare(`INSERT INTO mem_fts (source, rowid_ref, title, body) VALUES (?, ?, ?, ?)`).run(
    source,
    rowidRef,
    title,
    body,
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function str(v: FrontmatterValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return v.join(", ");
}

function int(v: FrontmatterValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function tagsToCsv(v: FrontmatterValue | undefined): string | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.length > 0 ? v.join(",") : null;
  const s = String(v).trim();
  return s ? s : null;
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 3;
  return Math.max(1, Math.min(5, Math.round(c)));
}
