import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "./schema.js";

export interface MemoryStoreOptions {
  readonly path: string;
}

export interface Episode {
  readonly kind: "session-start" | "session-end" | "goal-run" | "dispatch" | "note";
  readonly title: string;
  readonly body: string;
  readonly meta?: Record<string, unknown>;
}

export interface Decision {
  readonly topic: string;
  readonly decision: string;
  readonly rationale: string;
}

export interface ErrorSolution {
  readonly signature: string;
  readonly error: string;
  readonly solution: string;
  readonly context?: string;
}

export interface Pattern {
  readonly name: string;
  readonly body: string;
}

export interface RunRecord {
  readonly specTitle: string;
  readonly goal: string;
  readonly status: "finished" | "blocked" | "partial" | "failed" | "max-turns";
  readonly costUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly durationMs: number;
  readonly plan?: string;
  readonly mode?: string;
  readonly evidence: Record<string, unknown>;
}

export interface ResearchSourceRecord {
  readonly topic: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt?: string;
  readonly relevance: number;
  readonly excerpt: string;
}

export interface TasteRecord {
  readonly kind: "taste.md" | "taste.vision";
  readonly body: string;
  readonly source?: string;
}

export interface SubSpecRecord {
  readonly runId: number;
  readonly subSpecId: string;
  readonly title: string;
  readonly status: "finished" | "partial" | "failed" | "blocked" | "skipped";
  readonly evidence: Record<string, unknown>;
}

export interface SearchHit {
  readonly source: string;
  readonly rowidRef: number;
  readonly title: string;
  readonly snippet: string;
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(opts: MemoryStoreOptions) {
    mkdirSync(dirname(opts.path), { recursive: true });
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  recordEpisode(e: Episode): number {
    const stmt = this.db.prepare(
      `INSERT INTO episodes (kind, title, body, meta_json) VALUES (?, ?, ?, ?)`,
    );
    const r = stmt.run(e.kind, e.title, e.body, e.meta ? JSON.stringify(e.meta) : null);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("episodes", rowid, e.title, e.body);
    return rowid;
  }

  recordDecision(d: Decision): number {
    const stmt = this.db.prepare(
      `INSERT INTO decisions (topic, decision, rationale) VALUES (?, ?, ?)`,
    );
    const r = stmt.run(d.topic, d.decision, d.rationale);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("decisions", rowid, d.topic, `${d.decision}\n${d.rationale}`);
    return rowid;
  }

  recordErrorSolution(es: ErrorSolution): number {
    const stmt = this.db.prepare(
      `INSERT INTO errors_solutions (signature, error, solution, context) VALUES (?, ?, ?, ?)`,
    );
    const r = stmt.run(es.signature, es.error, es.solution, es.context ?? null);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("errors_solutions", rowid, es.signature, `${es.error}\n---\n${es.solution}`);
    return rowid;
  }

  recordPattern(p: Pattern): number {
    const stmt = this.db.prepare(`INSERT INTO patterns (name, body) VALUES (?, ?)`);
    const r = stmt.run(p.name, p.body);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("patterns", rowid, p.name, p.body);
    return rowid;
  }

  recordRun(r: RunRecord): number {
    const stmt = this.db.prepare(
      `INSERT INTO runs (spec_title, goal, status, cost_usd, tokens_in, tokens_out, duration_ms, plan, mode, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const res = stmt.run(
      r.specTitle,
      r.goal,
      r.status,
      r.costUsd,
      r.tokensIn,
      r.tokensOut,
      r.durationMs,
      r.plan ?? null,
      r.mode ?? null,
      JSON.stringify(r.evidence),
    );
    const rowid = Number(res.lastInsertRowid);
    this.indexFts("runs", rowid, r.specTitle, `${r.goal}\n${r.status}`);
    return rowid;
  }

  recordResearchSource(s: ResearchSourceRecord): number {
    const stmt = this.db.prepare(
      `INSERT INTO research_sources (topic, url, title, published_at, relevance, excerpt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const r = stmt.run(s.topic, s.url, s.title, s.publishedAt ?? null, s.relevance, s.excerpt);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("research_sources", rowid, s.title, `${s.topic}\n${s.url}\n${s.excerpt}`);
    return rowid;
  }

  recordTaste(t: TasteRecord): number {
    const stmt = this.db.prepare(
      `INSERT INTO taste_history (kind, body, source) VALUES (?, ?, ?)`,
    );
    const r = stmt.run(t.kind, t.body, t.source ?? null);
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("taste_history", rowid, t.kind, t.body);
    return rowid;
  }

  recordSubSpec(s: SubSpecRecord): number {
    const stmt = this.db.prepare(
      `INSERT INTO sub_specs (run_id, sub_spec_id, title, status, evidence_json) VALUES (?, ?, ?, ?, ?)`,
    );
    const r = stmt.run(s.runId, s.subSpecId, s.title, s.status, JSON.stringify(s.evidence));
    const rowid = Number(r.lastInsertRowid);
    this.indexFts("sub_specs", rowid, s.title, `${s.subSpecId}\n${s.status}`);
    return rowid;
  }

  search(q: string, limit = 20): readonly SearchHit[] {
    const stmt = this.db.prepare(
      `SELECT source, rowid_ref AS rowidRef, title, snippet(mem_fts, 3, '«', '»', '…', 16) AS snippet
       FROM mem_fts
       WHERE mem_fts MATCH ?
       ORDER BY bm25(mem_fts)
       LIMIT ?`,
    );
    return stmt.all(q, limit) as SearchHit[];
  }

  recentRuns(limit = 10): readonly {
    readonly id: number;
    readonly ts: string;
    readonly specTitle: string;
    readonly status: string;
    readonly costUsd: number;
    readonly plan: string | null;
    readonly mode: string | null;
  }[] {
    return this.db
      .prepare(
        `SELECT id, ts, spec_title AS specTitle, status, cost_usd AS costUsd, plan, mode
         FROM runs ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as never;
  }

  creditConsumedThisPeriod(periodStartIso?: string): number {
    const start = periodStartIso ?? startOfMonthIso();
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS sum FROM runs WHERE ts >= ?`,
      )
      .get(start) as { sum: number };
    return row?.sum ?? 0;
  }

  private indexFts(source: string, rowidRef: number, title: string, body: string): void {
    this.db
      .prepare(
        `INSERT INTO mem_fts (source, rowid_ref, title, body) VALUES (?, ?, ?, ?)`,
      )
      .run(source, rowidRef, title, body);
  }
}

function startOfMonthIso(): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return start.toISOString().slice(0, 19).replace("T", " ");
}
