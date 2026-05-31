import type Database from "better-sqlite3";
import {
  DEFAULT_STALE_AFTER_DAYS,
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
} from "@claudemax/memory";

export type GroundingKind = "decision" | "fact" | "fix" | "all";

export interface DecisionResult {
  readonly ref: string;
  readonly slug: string | null;
  readonly topic: string;
  readonly decision: string;
  readonly rationale: string;
  readonly scope: string;
  readonly invariant: boolean;
  readonly tags: string | null;
  readonly lastVerifiedAt: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export interface FactResult {
  readonly ref: string;
  readonly key: string;
  readonly value: string;
  readonly scope: string;
  readonly invariant: boolean;
  readonly confidence: number;
  readonly source: string | null;
  readonly tags: string | null;
  readonly lastVerifiedAt: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export interface SearchResult {
  readonly ref: string;
  readonly source: string;
  readonly title: string;
  readonly snippet: string;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

export interface StaleResult {
  readonly kind: "decision" | "fact";
  readonly ref: string;
  readonly addressable: string;
  readonly ageDays: number;
  readonly ttlDays: number;
}

function isStale(ageDays: number | null, ttlDays: number | null): boolean {
  return isStaleRaw(ageDays, ttlDays, DEFAULT_STALE_AFTER_DAYS);
}

function mapDecision(row: RawDecisionRow): DecisionResult {
  const ageDays = computeAgeDays(row.last_verified_at);
  return {
    ref: `decisions#${row.id}`,
    slug: row.slug,
    topic: row.topic,
    decision: row.decision,
    rationale: row.rationale,
    scope: row.scope ?? "**",
    invariant: row.invariant === 1,
    tags: row.tags,
    lastVerifiedAt: row.last_verified_at,
    ageDays,
    stale: isStale(ageDays, row.ttl_days),
  };
}

function mapFact(row: RawFactRow): FactResult {
  const ageDays = computeAgeDays(row.last_verified_at);
  return {
    ref: `project_facts#${row.id}`,
    key: row.key,
    value: row.value,
    scope: row.scope ?? "**",
    invariant: row.invariant === 1,
    confidence: row.confidence,
    source: row.source,
    tags: row.tags,
    lastVerifiedAt: row.last_verified_at,
    ageDays,
    stale: isStale(ageDays, row.ttl_days),
  };
}

// memory_get_decision — most-recent accepted decision for a slug.
export function getDecision(db: Database.Database, slug: string): DecisionResult | null {
  const row = db.prepare(GROUNDING_SELECT_DECISION_BY_SLUG).get(slug) as RawDecisionRow | undefined;
  return row ? mapDecision(row) : null;
}

// memory_get_fact — best accepted fact for a key under a querying scope.
// Most-specific glob wins (mirrors MemoryStore.getFact).
export function getFact(
  db: Database.Database,
  key: string,
  scope?: string,
): FactResult | null {
  const rows = db.prepare(GROUNDING_SELECT_FACTS_BY_KEY).all(key) as RawFactRow[];
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
  return best ? mapFact(best) : null;
}

// memory_stale — accepted invariant rows past their staleness window.
export function staleTruth(db: Database.Database, scope?: string): readonly StaleResult[] {
  const out: StaleResult[] = [];
  const decisions = db.prepare(GROUNDING_SELECT_STALE_DECISIONS).all() as RawDecisionRow[];
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
  const facts = db.prepare(GROUNDING_SELECT_STALE_FACTS).all() as RawFactRow[];
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

interface GroundingMeta {
  readonly scope: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
}

function fetchGroundingMeta(
  db: Database.Database,
  source: string,
  rowidRef: number,
): GroundingMeta | null {
  if (source === "decisions") {
    const row = db
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
    const row = db
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
  const row = db
    .prepare(`SELECT last_verified_at AS lastVerifiedAt FROM ${source} WHERE id = ?`)
    .get(rowidRef) as { lastVerifiedAt: string | null } | undefined;
  if (!row) return null;
  const ageDays = computeAgeDays(row.lastVerifiedAt);
  return { scope: null, ageDays, stale: isStale(ageDays, null) };
}

// memory_search — capped, scoped FTS hits across the grounding sources. Mirrors
// MemoryStore.searchGrounding: routes the free-text query through the SAME FTS5
// sanitizer (MATCH-injection guard), filters mem_fts to the grounding sources,
// then enriches each hit with ageDays/stale. Does NOT duplicate recall() scoring.
export function searchGrounding(
  db: Database.Database,
  query: string,
  kind: GroundingKind = "all",
  scope?: string,
  limit = 8,
): readonly SearchResult[] {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];
  const cap = Math.max(1, Math.min(limit, 25));
  const sources = groundingSourcesForKind(kind);
  const placeholders = sources.map(() => "?").join(", ");
  const rows = db
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

  const hits: SearchResult[] = [];
  for (const r of rows) {
    if (hits.length >= cap) break;
    const meta = fetchGroundingMeta(db, r.source, r.rowidRef);
    if (scope && meta && meta.scope && !globMatches(meta.scope, scope)) continue;
    hits.push({
      ref: `${r.source}#${r.rowidRef}`,
      source: r.source,
      title: r.title,
      snippet: r.snippet,
      ageDays: meta ? meta.ageDays : null,
      stale: meta ? meta.stale : false,
    });
  }
  return hits;
}

// Verbatim mirror of MemoryStore's private sanitizeFtsQuery (store.ts). Strips
// FTS5 operator characters, keeps alphanumerics + whitespace, wraps each token
// as a phrase. Kept identical so the MCP and CLI cannot drift on what reaches
// the FTS5 MATCH clause. Returns "" when nothing usable survives.
function sanitizeFtsQuery(raw: string): string {
  const trimmed = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (trimmed.length === 0) return "";
  return trimmed.map((t) => `"${t}"`).join(" OR ");
}

// Verbatim mirror of MemoryStore's private groundingSourcesForKind (store.ts).
// Must match the mem_fts.source strings used at indexFts() write time.
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
