import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MemoryStore } from "@claudemax/memory";
import { resolveDbPath } from "./migrate.js";

export interface CompileClaudeMdOptions {
  readonly dbPath?: string;
  readonly rootDir?: string;
}

export interface CompileClaudeMdResult {
  readonly filesWritten: readonly string[];
  readonly invariantsByScope: Readonly<Record<string, number>>;
}

const BEGIN_PREFIX = "<!-- GROUNDING:BEGIN";
const END_MARKER = "<!-- GROUNDING:END -->";
// Matches a previously-generated block regardless of its date stamp so the
// replace is idempotent across days.
const BLOCK_RE = /<!-- GROUNDING:BEGIN[^\n]*-->[\s\S]*?<!-- GROUNDING:END -->/;

interface InvariantRow {
  readonly addressable: string;
  readonly summary: string;
  readonly kind: "decision" | "fact";
  readonly verifiedDate: string;
}

// Compile accepted invariant rows into per-scope CLAUDE.md managed blocks. Only
// the text between the GROUNDING markers is ever touched; hand-written prose
// outside the markers is preserved. A scope with no existing markers gets the
// block appended at EOF (never a rewrite of the existing file).
export function compileClaudeMd(opts: CompileClaudeMdOptions = {}): CompileClaudeMdResult {
  const dbPath = opts.dbPath ?? resolveDbPath();
  const root = opts.rootDir ?? process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

  const store = new MemoryStore({ path: dbPath });
  store.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const byScope = new Map<string, InvariantRow[]>();
    const push = (scope: string, row: InvariantRow): void => {
      const list = byScope.get(scope) ?? [];
      list.push(row);
      byScope.set(scope, list);
    };

    const decisions = db
      .prepare(
        `SELECT slug, topic, scope, last_verified_at
         FROM decisions
         WHERE status = 'accepted' AND invariant = 1
         ORDER BY id`,
      )
      .all() as Array<{
      slug: string | null;
      topic: string;
      scope: string | null;
      last_verified_at: string | null;
    }>;
    for (const d of decisions) {
      push(d.scope ?? "**", {
        addressable: d.slug ?? d.topic,
        summary: d.topic,
        kind: "decision",
        verifiedDate: dateOnly(d.last_verified_at),
      });
    }

    const facts = db
      .prepare(
        `SELECT key, value, scope, last_verified_at
         FROM project_facts
         WHERE status = 'accepted' AND invariant = 1
         ORDER BY id`,
      )
      .all() as Array<{
      key: string;
      value: string;
      scope: string | null;
      last_verified_at: string | null;
    }>;
    for (const f of facts) {
      push(f.scope ?? "**", {
        addressable: f.key,
        summary: f.value,
        kind: "fact",
        verifiedDate: dateOnly(f.last_verified_at),
      });
    }

    const filesWritten: string[] = [];
    const invariantsByScope: Record<string, number> = {};
    for (const [scope, rows] of byScope) {
      const target = targetClaudeMd(root, scope);
      const block = renderBlock(rows);
      applyManagedBlock(target, block);
      filesWritten.push(target);
      invariantsByScope[scope] = rows.length;
    }

    return { filesWritten, invariantsByScope };
  } finally {
    db.close();
  }
}

// Root scope '**' → repo-root CLAUDE.md. A glob like 'packages/x/**' → the
// CLAUDE.md at packages/x. The trailing /** (and any wildcard tail) is stripped
// to a directory; if the result is not a clean directory glob it falls back to
// the root file.
function targetClaudeMd(root: string, scope: string): string {
  if (scope === "**" || scope === "" || scope === "*") return join(root, "CLAUDE.md");
  const dir = scope.replace(/\/\*+$/g, "").replace(/\/+$/g, "");
  if (dir === "" || dir.includes("*")) return join(root, "CLAUDE.md");
  return join(root, dir, "CLAUDE.md");
}

function renderBlock(rows: readonly InvariantRow[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `${BEGIN_PREFIX} (generated ${date} — do not edit by hand) -->`,
    "## Project invariants (compiled from memory.sqlite)",
    "",
  ];
  for (const r of rows) {
    const verified = r.verifiedDate ? ` · verified ${r.verifiedDate}` : "";
    lines.push(`- **${oneLine(r.summary)}** (${r.kind}: ${r.addressable}${verified})`);
  }
  lines.push(END_MARKER);
  return lines.join("\n");
}

function applyManagedBlock(target: string, block: string): void {
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    if (BLOCK_RE.test(current)) {
      const next = current.replace(BLOCK_RE, block);
      if (next !== current) writeFileSync(target, next, "utf8");
      return;
    }
    const sep = current.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(target, `${current}${sep}${block}\n`, "utf8");
    return;
  }
  writeFileSync(target, `${block}\n`, "utf8");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dateOnly(lastVerifiedAt: string | null): string {
  if (!lastVerifiedAt) return "";
  return lastVerifiedAt.slice(0, 10);
}
