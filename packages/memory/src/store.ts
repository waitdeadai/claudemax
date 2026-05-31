import Database from "better-sqlite3";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "./schema.js";
import {
  GROUNDING_SELECT_DECISION_BY_SLUG,
  GROUNDING_SELECT_FACTS_BY_KEY,
  GROUNDING_SELECT_STALE_DECISIONS,
  GROUNDING_SELECT_STALE_FACTS,
  computeAgeDays,
  globMatches,
  globSpecificity,
  isStale as isStaleRaw,
  type RawDecisionRow,
  type RawFactRow,
} from "./grounding-queries.js";

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
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly durationMs: number;
  readonly plan?: string;
  readonly mode?: string;
  readonly agentId?: string;
  readonly parentAgentId?: string;
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

// CoALA-aligned 5-tier taxonomy (arxiv 2309.02427) mapped to existing tables.
// - episode    → episodes
// - decision   → decisions
// - pattern    → patterns
// - error-solution → errors_solutions
// - graph      → episodes with kind='graph' (relationship/story memory)
export type MemoryTier =
  | "episode"
  | "decision"
  | "pattern"
  | "error-solution"
  | "graph";

export type RecallDepth = "simple" | "medium" | "deep";

export const RECALL_DEPTH_LIMITS: Readonly<Record<RecallDepth, number>> = {
  simple: 5,
  medium: 15,
  deep: 50,
};

// Memories not re-verified in this window get a STALE marker on recall.
// Source: mem0.ai 2026-05-21 SOTA report — staleness is the #1 unsolved
// problem in agent memory in 2026. Default 30 days matches industry norm.
export const DEFAULT_STALE_AFTER_DAYS = 30;

export interface RecallHit {
  readonly source: string;
  readonly rowidRef: number;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly ts: string;
  readonly lastVerifiedAt: string | null;
  readonly verifiedCount: number;
  readonly stale: boolean;
  readonly laneId: string | null;
  readonly runId: string | null;
}

export interface MultiScope {
  readonly runId?: string;
  readonly laneId?: string;
  readonly userId?: string;
  readonly appId?: string;
}

export interface AddOptions extends MultiScope {
  readonly tags?: readonly string[];
}

// Envelope appended to the JSONL queue. Drained into SQLite by drainQueue().
// Source: mem0.ai 2026-05-21 SOTA report — async-by-default writes is a
// winning architectural choice for memory systems.
export interface QueueEnvelope {
  readonly tier: MemoryTier;
  readonly title: string;
  readonly body: string;
  readonly meta?: Record<string, unknown>;
  readonly scope?: MultiScope;
  readonly ts: string;
}

export interface RecallOptions {
  readonly depth?: RecallDepth;
  readonly staleAfterDays?: number;
  readonly includeStale?: boolean;
  readonly scope?: MultiScope;
}

// ===== Grounding layer (decisions + project_facts) =====

export type GroundingStatus = "proposed" | "accepted" | "superseded" | "deprecated";

export interface DecisionRow {
  readonly id: number;
  readonly ts: string;
  readonly topic: string;
  readonly decision: string;
  readonly rationale: string;
  readonly slug: string | null;
  readonly status: string;
  readonly scope: string;
  readonly invariant: boolean;
  readonly ttlDays: number | null;
  readonly sourcePath: string | null;
  readonly tags: string | null;
  readonly lastVerifiedAt: string | null;
  readonly verifiedCount: number;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export interface FactRow {
  readonly id: number;
  readonly ts: string;
  readonly key: string;
  readonly value: string;
  readonly scope: string;
  readonly status: string;
  readonly invariant: boolean;
  readonly confidence: number;
  readonly source: string | null;
  readonly sourcePath: string | null;
  readonly tags: string | null;
  readonly ttlDays: number | null;
  readonly lastVerifiedAt: string | null;
  readonly verifiedCount: number;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export interface StaleRow {
  readonly kind: "decision" | "fact";
  readonly ref: string;
  readonly addressable: string;
  readonly ageDays: number;
  readonly ttlDays: number;
}

export interface GroundingHit {
  readonly source: string;
  readonly rowidRef: number;
  readonly title: string;
  readonly snippet: string;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export type GroundingKind = "decision" | "fact" | "fix" | "all";

export interface ProposeDecisionInput extends MultiScope {
  readonly slug: string;
  readonly title: string;
  readonly decision: string;
  readonly rationale?: string;
  readonly scope?: string;
  readonly invariant?: boolean;
  readonly ttlDays?: number;
  readonly sourcePath?: string;
  readonly tags?: readonly string[];
}

export interface ProposeFactInput extends MultiScope {
  readonly key: string;
  readonly value: string;
  readonly scope?: string;
  readonly confidence?: number;
  readonly invariant?: boolean;
  readonly source?: string;
  readonly sourcePath?: string;
  readonly ttlDays?: number;
  readonly tags?: readonly string[];
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(opts: MemoryStoreOptions) {
    mkdirSync(dirname(opts.path), { recursive: true });
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  // Idempotent forward migrations. SQLite ALTER TABLE ADD COLUMN throws if the
  // column already exists; we swallow that case so an existing DB picks up
  // new columns silently.
  private migrate(): void {
    const cols: Array<[string, string, string]> = [
      ["runs", "cache_read_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["runs", "cache_write_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["runs", "plan", "TEXT"],
      ["runs", "mode", "TEXT"],
      ["runs", "agent_id", "TEXT"],
      ["runs", "parent_agent_id", "TEXT"],
      ["runs", "run_id", "TEXT"],
      ["runs", "lane_id", "TEXT"],
      ["runs", "user_id", "TEXT"],
      ["runs", "app_id", "TEXT"],
      ["runs", "last_verified_at", "TEXT"],
      ["runs", "verified_count", "INTEGER NOT NULL DEFAULT 0"],
      ["episodes", "run_id", "TEXT"],
      ["episodes", "lane_id", "TEXT"],
      ["episodes", "user_id", "TEXT"],
      ["episodes", "app_id", "TEXT"],
      ["episodes", "last_verified_at", "TEXT"],
      ["episodes", "verified_count", "INTEGER NOT NULL DEFAULT 0"],
      ["decisions", "run_id", "TEXT"],
      ["decisions", "lane_id", "TEXT"],
      ["decisions", "user_id", "TEXT"],
      ["decisions", "app_id", "TEXT"],
      ["decisions", "last_verified_at", "TEXT"],
      ["decisions", "verified_count", "INTEGER NOT NULL DEFAULT 0"],
      ["decisions", "slug", "TEXT"],
      ["decisions", "status", "TEXT DEFAULT 'proposed'"],
      ["decisions", "scope", "TEXT DEFAULT '**'"],
      ["decisions", "invariant", "INTEGER NOT NULL DEFAULT 0"],
      ["decisions", "ttl_days", "INTEGER"],
      ["decisions", "source_path", "TEXT"],
      ["decisions", "tags", "TEXT"],
      ["errors_solutions", "run_id", "TEXT"],
      ["errors_solutions", "lane_id", "TEXT"],
      ["errors_solutions", "user_id", "TEXT"],
      ["errors_solutions", "app_id", "TEXT"],
      ["errors_solutions", "last_verified_at", "TEXT"],
      ["errors_solutions", "verified_count", "INTEGER NOT NULL DEFAULT 0"],
      ["patterns", "run_id", "TEXT"],
      ["patterns", "lane_id", "TEXT"],
      ["patterns", "user_id", "TEXT"],
      ["patterns", "app_id", "TEXT"],
      ["patterns", "last_verified_at", "TEXT"],
      ["patterns", "verified_count", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [table, col, def] of cols) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      } catch (e) {
        const msg = (e as Error).message.toLowerCase();
        if (!msg.includes("duplicate column")) {
          if (!msg.includes("already exists")) throw e;
        }
      }
    }
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_parent_agent ON runs(parent_agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_lane ON runs(lane_id)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_decisions_lane ON decisions(lane_id)`,
      `CREATE INDEX IF NOT EXISTS idx_errors_lane ON errors_solutions(lane_id)`,
      `CREATE INDEX IF NOT EXISTS idx_patterns_lane ON patterns(lane_id)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_verified ON runs(last_verified_at)`,
      `CREATE INDEX IF NOT EXISTS idx_decisions_verified ON decisions(last_verified_at)`,
      `CREATE INDEX IF NOT EXISTS idx_errors_verified ON errors_solutions(last_verified_at)`,
      `CREATE INDEX IF NOT EXISTS idx_decisions_slug ON decisions(slug)`,
      `CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`,
    ];
    for (const sql of indexes) {
      try {
        this.db.exec(sql);
      } catch {
        /* non-fatal */
      }
    }
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
      `INSERT INTO runs (spec_title, goal, status, cost_usd, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens, duration_ms, plan, mode, agent_id, parent_agent_id, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const res = stmt.run(
      r.specTitle,
      r.goal,
      r.status,
      r.costUsd,
      r.tokensIn,
      r.tokensOut,
      r.cacheReadTokens ?? 0,
      r.cacheWriteTokens ?? 0,
      r.durationMs,
      r.plan ?? null,
      r.mode ?? null,
      r.agentId ?? null,
      r.parentAgentId ?? null,
      JSON.stringify(r.evidence),
    );
    const rowid = Number(res.lastInsertRowid);
    this.indexFts("runs", rowid, r.specTitle, `${r.goal}\n${r.status}`);
    return rowid;
  }

  cacheStatsThisPeriod(periodStartIso?: string): {
    readonly totalInputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly hitRatePct: number;
  } {
    const start = periodStartIso ?? startOfMonthIso();
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in), 0) AS tokens_in,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
         FROM runs WHERE ts >= ?`,
      )
      .get(start) as { tokens_in: number; cache_read_tokens: number; cache_write_tokens: number };
    const totalInput = row?.tokens_in ?? 0;
    const cacheRead = row?.cache_read_tokens ?? 0;
    const hitRate = totalInput > 0 ? (cacheRead / totalInput) * 100 : 0;
    return {
      totalInputTokens: totalInput,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: row?.cache_write_tokens ?? 0,
      hitRatePct: hitRate,
    };
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

  // Fuzzy LOWER-LIKE match on topic, bounded by a max-age window. Used by
  // deepresearch to seed prior sources for a related topic before re-querying
  // the web.
  recentResearchSourcesForTopic(
    topic: string,
    maxAgeDays: number = 7,
    limit: number = 12,
  ): readonly ResearchSourceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT topic, url, title, published_at AS publishedAt, relevance, excerpt
         FROM research_sources
         WHERE LOWER(topic) LIKE LOWER('%' || ? || '%')
           AND ts > datetime('now', '-' || ? || ' days')
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(topic, maxAgeDays, limit) as Array<{
      topic: string;
      url: string;
      title: string;
      publishedAt: string | null;
      relevance: number;
      excerpt: string;
    }>;
    return rows.map((r) => ({
      topic: r.topic,
      url: r.url,
      title: r.title,
      publishedAt: r.publishedAt ?? undefined,
      relevance: r.relevance,
      excerpt: r.excerpt,
    }));
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

  // Unified write entry-point — maps CoALA 5-tier taxonomy to existing tables,
  // attaches multi-scope identity (run_id, lane_id, user_id, app_id), and
  // back-fills last_verified_at = now so freshly-written facts don't show as
  // stale immediately.
  add(tier: MemoryTier, title: string, body: string, opts: AddOptions = {}): {
    readonly source: string;
    readonly rowidRef: number;
  } {
    const scope = {
      run_id: opts.runId ?? null,
      lane_id: opts.laneId ?? null,
      user_id: opts.userId ?? null,
      app_id: opts.appId ?? null,
    };
    const fresh = nowSqliteIso();
    let source: string;
    let rowidRef: number;
    switch (tier) {
      case "episode":
      case "graph": {
        const stmt = this.db.prepare(
          `INSERT INTO episodes (kind, title, body, meta_json, run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        );
        const r = stmt.run(
          tier === "graph" ? "graph" : "note",
          title,
          body,
          opts.tags ? JSON.stringify({ tags: opts.tags }) : null,
          scope.run_id,
          scope.lane_id,
          scope.user_id,
          scope.app_id,
          fresh,
        );
        source = "episodes";
        rowidRef = Number(r.lastInsertRowid);
        break;
      }
      case "decision": {
        const stmt = this.db.prepare(
          `INSERT INTO decisions (topic, decision, rationale, run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        );
        const r = stmt.run(
          title,
          body,
          opts.tags ? `tags: ${opts.tags.join(", ")}` : "",
          scope.run_id,
          scope.lane_id,
          scope.user_id,
          scope.app_id,
          fresh,
        );
        source = "decisions";
        rowidRef = Number(r.lastInsertRowid);
        break;
      }
      case "pattern": {
        const stmt = this.db.prepare(
          `INSERT INTO patterns (name, body, run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        );
        const r = stmt.run(
          title,
          body,
          scope.run_id,
          scope.lane_id,
          scope.user_id,
          scope.app_id,
          fresh,
        );
        source = "patterns";
        rowidRef = Number(r.lastInsertRowid);
        break;
      }
      case "error-solution": {
        const stmt = this.db.prepare(
          `INSERT INTO errors_solutions (signature, error, solution, context, run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        );
        const r = stmt.run(
          title,
          title,
          body,
          opts.tags ? `tags: ${opts.tags.join(", ")}` : null,
          scope.run_id,
          scope.lane_id,
          scope.user_id,
          scope.app_id,
          fresh,
        );
        source = "errors_solutions";
        rowidRef = Number(r.lastInsertRowid);
        break;
      }
      default:
        throw new Error(`unknown memory tier: ${String(tier)}`);
    }
    this.indexFts(source, rowidRef, title, body);
    return { source, rowidRef };
  }

  // Multi-signal recall (mem0.ai 2026-05-21 SOTA report: hybrid retrieval
  // beats pure semantic similarity). Composite score = BM25 base + entity-match
  // boost + recency decay + recently-verified boost − staleness penalty.
  recall(task: string, opts: RecallOptions = {}): readonly RecallHit[] {
    const depth = opts.depth ?? "medium";
    const limit = RECALL_DEPTH_LIMITS[depth];
    const staleAfterDays = opts.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
    const includeStale = opts.includeStale ?? true;
    const ftsQuery = sanitizeFtsQuery(task);

    if (!ftsQuery) return [];

    type Row = {
      readonly source: string;
      readonly rowidRef: number;
      readonly title: string;
      readonly snippet: string;
      readonly body: string;
      readonly bm25: number;
    };
    const overFetch = Math.max(limit * 4, 40);
    const rows = this.db
      .prepare(
        `SELECT source, rowid_ref AS rowidRef, title,
                snippet(mem_fts, 3, '«', '»', '…', 16) AS snippet,
                substr(body, 1, 600) AS body,
                bm25(mem_fts) AS bm25
         FROM mem_fts
         WHERE mem_fts MATCH ?
         ORDER BY bm25(mem_fts)
         LIMIT ?`,
      )
      .all(ftsQuery, overFetch) as Row[];

    if (rows.length === 0) return [];

    const queryEntities = extractEntities(task);
    const nowMs = Date.now();
    const staleThresholdMs = staleAfterDays * 24 * 60 * 60 * 1000;

    const enriched: RecallHit[] = [];
    for (const r of rows) {
      const meta = this.fetchMeta(r.source, r.rowidRef, opts.scope);
      if (!meta) continue;

      // BM25 in SQLite FTS5 is negative (lower = better). Flip sign and clamp.
      const bm25Component = Math.max(0, -r.bm25);
      const rowEntities = extractEntities(`${r.title} ${r.body}`);
      const overlap = setOverlap(queryEntities, rowEntities);
      const entityBoost = overlap * 2;

      const ageMs = nowMs - new Date(meta.ts).getTime();
      const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
      // Light recency decay: half-life ~14 days.
      const recencyComponent = Math.exp(-ageDays / 14);

      const verifiedBoost = meta.verifiedCount > 0 ? Math.log1p(meta.verifiedCount) * 0.5 : 0;

      const stale = meta.lastVerifiedAt
        ? nowMs - new Date(meta.lastVerifiedAt).getTime() > staleThresholdMs
        : ageMs > staleThresholdMs;
      const staleness = stale ? -0.5 : 0;

      if (stale && !includeStale) continue;

      const score = bm25Component + entityBoost + recencyComponent + verifiedBoost + staleness;
      enriched.push({
        source: r.source,
        rowidRef: r.rowidRef,
        title: r.title,
        snippet: r.snippet,
        score,
        ts: meta.ts,
        lastVerifiedAt: meta.lastVerifiedAt,
        verifiedCount: meta.verifiedCount,
        stale,
        laneId: meta.laneId,
        runId: meta.runId,
      });
    }
    enriched.sort((a, b) => b.score - a.score);
    return enriched.slice(0, limit);
  }

  // Mark a recalled row as still-valid (defeats staleness; bumps verified_count).
  // Subagents call this after citing a memory row that turned out correct.
  markVerified(source: string, rowidRef: number, by?: string): boolean {
    if (!SCOPED_TABLES.has(source)) return false;
    const fresh = nowSqliteIso();
    const stmt = this.db.prepare(
      `UPDATE ${source}
       SET last_verified_at = ?, verified_count = COALESCE(verified_count, 0) + 1
       WHERE id = ?`,
    );
    const r = stmt.run(fresh, rowidRef);
    if (r.changes > 0 && by) {
      // Tiny audit trail in episodes — keeps the verification history searchable.
      try {
        this.add("episode", `memory-verify:${source}#${rowidRef}`, `verified by ${by}`, {});
      } catch {
        /* non-fatal */
      }
    }
    return r.changes > 0;
  }

  // Append a write envelope to the JSONL queue. Drain later with drainQueue().
  // Use this from hot paths where SQLite write latency is unacceptable.
  enqueueWrite(queuePath: string, env: QueueEnvelope): void {
    mkdirSync(dirname(queuePath), { recursive: true });
    appendFileSync(queuePath, JSON.stringify(env) + "\n", "utf8");
  }

  // Consume queued envelopes into SQLite. Returns count drained. The .jsonl
  // is renamed to .jsonl.draining first so concurrent writers can keep
  // appending to a fresh .jsonl without losing data.
  drainQueue(queuePath: string): number {
    if (!existsSync(queuePath)) return 0;
    const draining = queuePath + ".draining";
    try {
      renameSync(queuePath, draining);
    } catch {
      return 0;
    }
    let drained = 0;
    try {
      const raw = readFileSync(draining, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const env = JSON.parse(line) as QueueEnvelope;
          this.add(env.tier, env.title, env.body, {
            ...(env.scope ?? {}),
            tags: env.meta?.["tags"] as readonly string[] | undefined,
          });
          drained += 1;
        } catch {
          /* skip malformed line */
        }
      }
    } finally {
      try {
        // Truncate the draining file once consumed; preserves the most-recent
        // tail for crash recovery if drain partially-completed.
        writeFileSync(draining, "", "utf8");
      } catch {
        /* non-fatal */
      }
    }
    return drained;
  }

  // Read multi-scope + verification meta for a (source, rowidRef) pair.
  // Filtered by optional scope (any provided dimension must match).
  private fetchMeta(
    source: string,
    rowidRef: number,
    scope?: MultiScope,
  ): {
    readonly ts: string;
    readonly lastVerifiedAt: string | null;
    readonly verifiedCount: number;
    readonly laneId: string | null;
    readonly runId: string | null;
  } | null {
    if (!SCOPED_TABLES.has(source)) {
      // Tables without multi-scope yet (e.g. research_sources, sub_specs) —
      // surface as ts-only with no verification meta.
      const row = this.db
        .prepare(`SELECT ts FROM ${source} WHERE id = ?`)
        .get(rowidRef) as { ts?: string } | undefined;
      if (!row?.ts) return null;
      return {
        ts: row.ts,
        lastVerifiedAt: null,
        verifiedCount: 0,
        laneId: null,
        runId: null,
      };
    }
    const row = this.db
      .prepare(
        `SELECT ts, last_verified_at AS lastVerifiedAt,
                COALESCE(verified_count, 0) AS verifiedCount,
                lane_id AS laneId, run_id AS runId
         FROM ${source} WHERE id = ?`,
      )
      .get(rowidRef) as
      | {
          ts: string;
          lastVerifiedAt: string | null;
          verifiedCount: number;
          laneId: string | null;
          runId: string | null;
        }
      | undefined;
    if (!row) return null;
    if (scope?.laneId && row.laneId !== scope.laneId) return null;
    if (scope?.runId && row.runId !== scope.runId) return null;
    return row;
  }

  // ===== Grounding read methods (the surface the read-only MCP wraps) =====

  // Most-recent accepted decision for a slug. Computes ageDays from
  // last_verified_at and flags stale past ttl_days (or DEFAULT_STALE_AFTER_DAYS).
  getDecisionBySlug(slug: string): DecisionRow | null {
    const row = this.db.prepare(GROUNDING_SELECT_DECISION_BY_SLUG).get(slug) as
      | RawDecisionRow
      | undefined;
    if (!row) return null;
    return mapDecisionRow(row);
  }

  // Best accepted fact for a key under a querying scope. Most-specific glob wins:
  // among accepted rows whose scope glob matches `scope`, the longest non-'**'
  // matching glob is preferred; '**' is the fallback.
  getFact(key: string, scope?: string): FactRow | null {
    const rows = this.db.prepare(GROUNDING_SELECT_FACTS_BY_KEY).all(key) as RawFactRow[];
    if (rows.length === 0) return null;
    const querying = scope ?? "**";
    let best: RawFactRow | null = null;
    let bestSpecificity = -1;
    for (const r of rows) {
      const glob = r.scope ?? "**";
      if (!globMatches(glob, querying)) continue;
      const specificity = globSpecificity(glob);
      if (specificity > bestSpecificity) {
        best = r;
        bestSpecificity = specificity;
      }
    }
    if (!best) return null;
    return mapFactRow(best);
  }

  // Accepted invariant rows (decisions + facts) past their staleness window.
  // Reuses last_verified_at; ttl_days overrides the default window per-row.
  // Replaces the spec's stale_truth SQL view with a TS method.
  staleTruth(scope?: string): readonly StaleRow[] {
    const out: StaleRow[] = [];
    const decisions = this.db.prepare(GROUNDING_SELECT_STALE_DECISIONS).all() as RawDecisionRow[];
    for (const d of decisions) {
      if (scope && !globMatches(d.scope ?? "**", scope)) continue;
      const ageDays = computeAgeDays(d.last_verified_at);
      const ttlDays = d.ttl_days ?? DEFAULT_STALE_AFTER_DAYS;
      if (ageDays === null || ageDays <= ttlDays) continue;
      out.push({
        kind: "decision",
        ref: `decisions#${d.id}`,
        addressable: d.slug ?? String(d.id),
        ageDays,
        ttlDays,
      });
    }
    const facts = this.db.prepare(GROUNDING_SELECT_STALE_FACTS).all() as RawFactRow[];
    for (const f of facts) {
      if (scope && !globMatches(f.scope ?? "**", scope)) continue;
      const ageDays = computeAgeDays(f.last_verified_at);
      const ttlDays = f.ttl_days ?? DEFAULT_STALE_AFTER_DAYS;
      if (ageDays === null || ageDays <= ttlDays) continue;
      out.push({
        kind: "fact",
        ref: `project_facts#${f.id}`,
        addressable: f.key,
        ageDays,
        ttlDays,
      });
    }
    return out;
  }

  // Lighter scoped/capped FTS hit list for the MCP's memory_search. Routes the
  // free-text query through sanitizeFtsQuery (FTS5 MATCH injection guard), filters
  // mem_fts to the grounding sources, then enriches each hit with ageDays/stale.
  // Does NOT duplicate recall() scoring.
  searchGrounding(
    query: string,
    kind: GroundingKind = "all",
    scope?: string,
    limit = 8,
  ): readonly GroundingHit[] {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];
    const cap = Math.max(1, Math.min(limit, 25));
    const sources = groundingSourcesForKind(kind);
    const placeholders = sources.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT source, rowid_ref AS rowidRef, title,
                snippet(mem_fts, 3, '«', '»', '…', 16) AS snippet
         FROM mem_fts
         WHERE mem_fts MATCH ? AND source IN (${placeholders})
         ORDER BY bm25(mem_fts)
         LIMIT ?`,
      )
      .all(ftsQuery, ...sources, cap * 3) as Array<{
      source: string;
      rowidRef: number;
      title: string;
      snippet: string;
    }>;

    const hits: GroundingHit[] = [];
    for (const r of rows) {
      if (hits.length >= cap) break;
      const meta = this.fetchGroundingMeta(r.source, r.rowidRef);
      if (scope && meta && meta.scope && !globMatches(meta.scope, scope)) continue;
      hits.push({
        source: r.source,
        rowidRef: r.rowidRef,
        title: r.title,
        snippet: r.snippet,
        ageDays: meta ? meta.ageDays : null,
        stale: meta ? meta.stale : false,
      });
    }
    return hits;
  }

  // ===== Grounding write helpers (append path; status='proposed') =====

  // Agents PROPOSE; humans bless. Inserts a proposed decision, sets
  // last_verified_at = now, indexes into mem_fts. Never accepts/blesses.
  proposeDecision(input: ProposeDecisionInput): number {
    const fresh = nowSqliteIso();
    const tags = input.tags && input.tags.length > 0 ? input.tags.join(",") : null;
    const stmt = this.db.prepare(
      `INSERT INTO decisions
         (topic, decision, rationale, slug, status, scope, invariant, ttl_days, source_path, tags,
          run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
       VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    );
    const r = stmt.run(
      input.title,
      input.decision,
      input.rationale ?? "",
      input.slug,
      input.scope ?? "**",
      input.invariant ? 1 : 0,
      input.ttlDays ?? null,
      input.sourcePath ?? null,
      tags,
      input.runId ?? null,
      input.laneId ?? null,
      input.userId ?? null,
      input.appId ?? null,
      fresh,
    );
    const rowid = Number(r.lastInsertRowid);
    this.indexFts(
      "decisions",
      rowid,
      input.title,
      `${input.decision}\n${input.rationale ?? ""}`,
    );
    return rowid;
  }

  // Inserts a proposed fact (UNIQUE(key,scope) → upsert keeps it proposed),
  // sets last_verified_at = now, indexes into mem_fts. Never accepts/blesses.
  proposeFact(input: ProposeFactInput): number {
    const fresh = nowSqliteIso();
    const tags = input.tags && input.tags.length > 0 ? input.tags.join(",") : null;
    const scope = input.scope ?? "**";
    const confidence = clampConfidence(input.confidence ?? 3);
    const stmt = this.db.prepare(
      `INSERT INTO project_facts
         (key, value, scope, status, invariant, confidence, source, source_path, tags, ttl_days,
          run_id, lane_id, user_id, app_id, last_verified_at, verified_count)
       VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(key, scope) DO UPDATE SET
         value = excluded.value,
         status = 'proposed',
         invariant = excluded.invariant,
         confidence = excluded.confidence,
         source = excluded.source,
         source_path = excluded.source_path,
         tags = excluded.tags,
         ttl_days = excluded.ttl_days,
         last_verified_at = excluded.last_verified_at`,
    );
    const r = stmt.run(
      input.key,
      input.value,
      scope,
      input.invariant ? 1 : 0,
      confidence,
      input.source ?? null,
      input.sourcePath ?? null,
      tags,
      input.ttlDays ?? null,
      input.runId ?? null,
      input.laneId ?? null,
      input.userId ?? null,
      input.appId ?? null,
      fresh,
    );
    let rowid = Number(r.lastInsertRowid);
    if (r.changes === 0 || rowid === 0) {
      const existing = this.db
        .prepare(`SELECT id FROM project_facts WHERE key = ? AND scope = ?`)
        .get(input.key, scope) as { id: number } | undefined;
      rowid = existing?.id ?? rowid;
    }
    this.indexFts("project_facts", rowid, input.key, input.value);
    return rowid;
  }

  // Scope + verification meta for a grounding row, with computed ageDays/stale.
  private fetchGroundingMeta(
    source: string,
    rowidRef: number,
  ): { readonly scope: string | null; readonly ageDays: number | null; readonly stale: boolean } | null {
    if (source === "decisions") {
      const row = this.db
        .prepare(
          `SELECT scope, ttl_days AS ttlDays, last_verified_at AS lastVerifiedAt
           FROM decisions WHERE id = ?`,
        )
        .get(rowidRef) as
        | { scope: string | null; ttlDays: number | null; lastVerifiedAt: string | null }
        | undefined;
      if (!row) return null;
      const ageDays = computeAgeDays(row.lastVerifiedAt);
      return { scope: row.scope, ageDays, stale: isStale(ageDays, row.ttlDays) };
    }
    if (source === "project_facts") {
      const row = this.db
        .prepare(
          `SELECT scope, ttl_days AS ttlDays, last_verified_at AS lastVerifiedAt
           FROM project_facts WHERE id = ?`,
        )
        .get(rowidRef) as
        | { scope: string | null; ttlDays: number | null; lastVerifiedAt: string | null }
        | undefined;
      if (!row) return null;
      const ageDays = computeAgeDays(row.lastVerifiedAt);
      return { scope: row.scope, ageDays, stale: isStale(ageDays, row.ttlDays) };
    }
    const row = this.db
      .prepare(`SELECT last_verified_at AS lastVerifiedAt FROM ${source} WHERE id = ?`)
      .get(rowidRef) as { lastVerifiedAt: string | null } | undefined;
    if (!row) return null;
    const ageDays = computeAgeDays(row.lastVerifiedAt);
    return { scope: null, ageDays, stale: isStale(ageDays, null) };
  }
}

// Tables that carry multi-scope + verification columns. research_sources,
// sub_specs, taste_history are first-class memory but use a different schema.
const SCOPED_TABLES: ReadonlySet<string> = new Set([
  "runs",
  "episodes",
  "decisions",
  "patterns",
  "errors_solutions",
]);

function nowSqliteIso(): string {
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS"; mirror that so
  // string comparisons against existing ts values stay consistent.
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// FTS5 query sanitization. Strips characters that would otherwise be parsed
// as FTS5 operators (parens, quotes, hyphens, colons, plus, etc.), preserves
// alphanumerics + whitespace, and surrounds each token with "" so it's a
// phrase rather than an operator. Returns "" when nothing usable survives.
function sanitizeFtsQuery(raw: string): string {
  const trimmed = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (trimmed.length === 0) return "";
  return trimmed.map((t) => `"${t}"`).join(" OR ");
}

// Cheap entity extraction: capitalized words ≥ 3 chars (e.g. "Lemon Squeezy",
// "Keepa") + identifier-shaped tokens (snake_case, camelCase, dotted paths).
// Anchored to the structural shape; intentionally not LLM-based per Letta's
// 2025-08-12 finding that simpler tools work better.
function extractEntities(s: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  const capMatches = s.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g);
  if (capMatches) for (const m of capMatches) tokens.add(m.toLowerCase());
  const idMatches = s.match(/\b[a-zA-Z][a-zA-Z0-9_.-]{3,}\b/g);
  if (idMatches)
    for (const m of idMatches) {
      if (/[._-]/.test(m) || /[a-z][A-Z]/.test(m)) tokens.add(m.toLowerCase());
    }
  return tokens;
}

function setOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

// Default queue path for a project. Kept here so the runtime + CLI agree.
export function defaultQueuePath(cwd: string): string {
  return join(cwd, ".claudemax", "memory.queue.jsonl");
}

function startOfMonthIso(): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return start.toISOString().slice(0, 19).replace("T", " ");
}

// 2-arg staleness using the module default window, so call sites stay terse.
function isStale(ageDays: number | null, ttlDays: number | null): boolean {
  return isStaleRaw(ageDays, ttlDays, DEFAULT_STALE_AFTER_DAYS);
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 3;
  return Math.max(1, Math.min(5, Math.round(c)));
}

// mem_fts.source strings the grounding kinds map to. Must match the strings
// passed to indexFts() at write time, or filtering silently returns no hits.
function groundingSourcesForKind(kind: GroundingKind): readonly string[] {
  switch (kind) {
    case "decision":
      return ["decisions"];
    case "fact":
      return ["project_facts"];
    case "fix":
      return ["errors_solutions"];
    default:
      return ["decisions", "project_facts", "errors_solutions"];
  }
}

function mapDecisionRow(row: RawDecisionRow): DecisionRow {
  const ageDays = computeAgeDays(row.last_verified_at);
  return {
    id: row.id,
    ts: row.ts,
    topic: row.topic,
    decision: row.decision,
    rationale: row.rationale,
    slug: row.slug,
    status: row.status,
    scope: row.scope ?? "**",
    invariant: row.invariant === 1,
    ttlDays: row.ttl_days,
    sourcePath: row.source_path,
    tags: row.tags,
    lastVerifiedAt: row.last_verified_at,
    verifiedCount: row.verified_count,
    ageDays,
    stale: isStale(ageDays, row.ttl_days),
  };
}

function mapFactRow(row: RawFactRow): FactRow {
  const ageDays = computeAgeDays(row.last_verified_at);
  return {
    id: row.id,
    ts: row.ts,
    key: row.key,
    value: row.value,
    scope: row.scope ?? "**",
    status: row.status,
    invariant: row.invariant === 1,
    confidence: row.confidence,
    source: row.source,
    sourcePath: row.source_path,
    tags: row.tags,
    ttlDays: row.ttl_days,
    lastVerifiedAt: row.last_verified_at,
    verifiedCount: row.verified_count,
    ageDays,
    stale: isStale(ageDays, row.ttl_days),
  };
}
