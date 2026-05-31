// Shared SELECT strings for the grounding read path. Both the writeable
// MemoryStore (store.ts) and the read-only memory-mcp package import these so
// the CLI and MCP cannot drift on the SQL they run against the same DB.
//
// Column lists are explicit (not SELECT *) so the raw-row mappers in store.ts
// stay stable if the table later gains columns. snake_case is preserved here;
// the mappers convert to camelCase.

export const GROUNDING_SELECT_DECISION_BY_SLUG = `
SELECT id, ts, topic, decision, rationale, slug, status, scope, invariant,
       ttl_days, source_path, tags, last_verified_at, verified_count
FROM decisions
WHERE slug = ? AND status = 'accepted'
ORDER BY id DESC
LIMIT 1
`;

export const GROUNDING_SELECT_FACTS_BY_KEY = `
SELECT id, ts, key, value, scope, status, invariant, confidence, source,
       source_path, tags, ttl_days, last_verified_at, verified_count
FROM project_facts
WHERE key = ? AND status = 'accepted'
ORDER BY id DESC
`;

export const GROUNDING_SELECT_STALE_DECISIONS = `
SELECT id, ts, topic, decision, rationale, slug, status, scope, invariant,
       ttl_days, source_path, tags, last_verified_at, verified_count
FROM decisions
WHERE status = 'accepted' AND invariant = 1
`;

export const GROUNDING_SELECT_STALE_FACTS = `
SELECT id, ts, key, value, scope, status, invariant, confidence, source,
       source_path, tags, ttl_days, last_verified_at, verified_count
FROM project_facts
WHERE status = 'accepted' AND invariant = 1
`;

// Raw (snake_case) row shapes returned by the SELECTs above. Exported so the
// MCP package can reuse the same mappers if it imports them.
export interface RawDecisionRow {
  readonly id: number;
  readonly ts: string;
  readonly topic: string;
  readonly decision: string;
  readonly rationale: string;
  readonly slug: string | null;
  readonly status: string;
  readonly scope: string | null;
  readonly invariant: number;
  readonly ttl_days: number | null;
  readonly source_path: string | null;
  readonly tags: string | null;
  readonly last_verified_at: string | null;
  readonly verified_count: number;
}

export interface RawFactRow {
  readonly id: number;
  readonly ts: string;
  readonly key: string;
  readonly value: string;
  readonly scope: string | null;
  readonly status: string;
  readonly invariant: number;
  readonly confidence: number;
  readonly source: string | null;
  readonly source_path: string | null;
  readonly tags: string | null;
  readonly ttl_days: number | null;
  readonly last_verified_at: string | null;
  readonly verified_count: number;
}

// Days since last_verified_at (fractional). null when never verified — callers
// treat a null age as "not stale by age" since there is no anchor to measure.
export function computeAgeDays(lastVerifiedAt: string | null): number | null {
  if (!lastVerifiedAt) return null;
  const then = Date.parse(lastVerifiedAt.replace(" ", "T"));
  if (Number.isNaN(then)) return null;
  const ageMs = Date.now() - then;
  return Math.max(0, ageMs / (1000 * 60 * 60 * 24));
}

// A row is stale once its age exceeds ttl_days (per-row override) or the
// caller-supplied default window. A null age (never verified) is not stale.
export function isStale(
  ageDays: number | null,
  ttlDays: number | null,
  defaultWindowDays: number,
): boolean {
  if (ageDays === null) return false;
  return ageDays > (ttlDays ?? defaultWindowDays);
}

// Glob specificity for most-specific-wins resolution. '**' (the universal
// fallback) ranks lowest; longer, more-segmented globs rank higher.
export function globSpecificity(glob: string): number {
  if (glob === "**" || glob === "") return 0;
  const segments = glob.split("/").filter(Boolean).length;
  const literal = glob.replace(/[*?]/g, "").length;
  return segments * 100 + literal;
}

// Does `glob` (a path glob like 'packages/auth/**') apply to the querying
// `path`? '**' matches everything. Supports '*' (single segment) and '**'
// (any depth). Anchored, case-sensitive — paths are lowercased upstream if needed.
export function globMatches(glob: string, path: string): boolean {
  if (glob === "**" || glob === "" || glob === "*") return true;
  if (glob === path) return true;
  const re = globToRegExp(glob);
  return re.test(path);
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c as string)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}
