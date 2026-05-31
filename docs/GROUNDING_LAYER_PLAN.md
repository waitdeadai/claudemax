# Grounding Layer — Implementation Plan (repo-accurate)

**Status:** build contract. Every implementer follows THIS file, not `GROUNDING_LAYER.md` verbatim. Where the build spec conflicts with the actual repo, this plan wins. Reconciliations are called out inline with **[RECONCILED]**.

**Source spec:** `/home/fer/Music/GROUNDING_LAYER.md`
**Ground-truth files read:** `packages/memory/src/{schema.ts,store.ts,index.ts}`, `packages/cli/src/commands/memory.ts`, `packages/cli/src/index.ts`, `.claude/settings.json`, `packages/runtime/src/{prompts.ts,orchestrator.ts,agent-teams.ts,multispec.ts,goal.ts,sdk-options.ts}`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/memory/{package.json,tsconfig.json}`, `.gitignore`, `docs/MCP_SERVERS.md`.

---

## 0. The seven reconciliations (read before touching anything)

1. **`decisions` table already exists** with columns `id, ts, topic, decision, rationale, superseded_by, run_id, lane_id, user_id, app_id, last_verified_at, verified_count`. We **EXTEND** it via idempotent `ALTER TABLE ADD COLUMN`. We do **NOT** drop/recreate it and we do **NOT** use the spec's `slug TEXT UNIQUE NOT NULL` / `title NOT NULL` / `CHECK(...)` shape — those require a table rebuild and would break the existing `add("decision", ...)` / `recordDecision()` insert paths. New columns are all NULLABLE or `DEFAULT`-ed.

2. **Staleness reuses `last_verified_at` + `verified_count`.** The spec's `verified_on TEXT NOT NULL` + `stale_truth` view are **[RECONCILED]** to the existing mechanism: `recall()` already flags `stale` via `staleAfterDays` (default `DEFAULT_STALE_AFTER_DAYS = 30`). We do NOT add a parallel `verified_on` column. `ttl_days` becomes an **optional per-row override** of the 30-day default window. Age is computed `julianday('now') - julianday(last_verified_at)`.

3. **MCP is read-only and WRAPS `MemoryStore`.** It never reimplements `recall()` scoring. New thin read methods get added to `store.ts` (`getDecisionBySlug`, `getFact`, `staleTruth`, `searchGrounding`). The DB handle in the MCP is opened `{ readonly: true }`.

4. **MCP registration uses `.mcp.json`, not `settings.json`.** **[RECONCILED — rule 9 vs. SOTA]** The research is unambiguous: `.claude/settings.json` does **not** hold `mcpServers` for Claude Code (it is for permissions/hooks/env only); the canonical project-scoped, git-committed location is `.mcp.json` at repo root, and the Agent SDK inherits it because `baseSdkOptions()` already sets `settingSources: ["user", "project"]`. We honor the *intent* of rule 9 ("registered for both modes") by: (a) committing `.mcp.json` (Claude Code / Mode B path), and (b) passing an **inline `mcpServers` + `allowedTools`** block into the Agent SDK `query()` calls that spawn workers (Mode A determinism — does not rely on tool-search/approval). `docs/MCP_SERVERS.md` already documents a `settings.json.mcpServers` block; we update that doc to point at `.mcp.json` for the first-party memory server.

5. **`freshness-gate.sh` is first-party, referenced directly** in `settings.json` like `cmax-session-start.sh` — NOT through `dp.sh` (that wrapper is only for vendored `llm-dark-patterns` hooks). Fail-open, `exit 0`, emit `hookSpecificOutput.additionalContext`, never block.

6. **Ref convention stays `source#id`** (e.g. `decisions#42`), already parsed by `cmax memory verify` via `/^([a-z_]+)#(\d+)$/`. `project_facts` is `[a-z_]+`-safe so `project_facts#7` matches.

7. **Only CODE is committed.** `**/.claudemax/`, `**/memory.sqlite*` are gitignored. The DB path resolves at runtime: `env CLAUDEMAX_DB` else `.claudemax/memory.sqlite` (relative to `CLAUDE_PROJECT_DIR`/cwd). `vault/` IS committed (markdown in git).

---

## 1. Schema migration (OWNED by `packages/memory/src/{schema.ts,store.ts}`)

The repo pattern: `SCHEMA_SQL` (in `schema.ts`) holds `CREATE TABLE IF NOT EXISTS` for **baseline** tables and runs FIRST in the `MemoryStore` constructor; then `migrate()` (in `store.ts`) does idempotent `ALTER TABLE ADD COLUMN` in a try/catch that swallows `duplicate column` / `already exists`. New tables that are entirely new go in `SCHEMA_SQL`; new columns on the existing `decisions` table go in `migrate()`'s `cols` array.

### 1a. `schema.ts` additions (append to `SCHEMA_SQL` template string)

`project_facts` is genuinely new → `CREATE TABLE IF NOT EXISTS` in `SCHEMA_SQL`, mirroring the repo's column conventions (`ts`, scope ids, `last_verified_at`, `verified_count`) **plus** the grounding fields:

```sql
CREATE TABLE IF NOT EXISTS project_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '**',
  status TEXT NOT NULL DEFAULT 'proposed',
  invariant INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 3,
  source TEXT,
  source_path TEXT,
  tags TEXT,
  ttl_days INTEGER,
  run_id TEXT,
  lane_id TEXT,
  user_id TEXT,
  app_id TEXT,
  last_verified_at TEXT,
  verified_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (key, scope)
);

CREATE INDEX IF NOT EXISTS idx_project_facts_key ON project_facts(key);
CREATE INDEX IF NOT EXISTS idx_project_facts_status ON project_facts(status);
```

**No CHECK constraints** (the repo uses none; keep `status`/`confidence` validation in TS at the write path, matching how `VALID_TIERS`/`VALID_DEPTHS` are enforced in `commands/memory.ts`). **No separate FTS5 virtual table + triggers** — **[RECONCILED]**: the repo uses ONE shared `mem_fts` table fed by `indexFts(source, rowidRef, title, body)` and BM25-ranked in `search()`/`recall()`. New rows index into `mem_fts` with `source='project_facts'` / `source='decisions'`. We do **NOT** introduce `decisions_fts` / `project_facts_fts` or the `_ai`/`_ad`/`_au` triggers from the spec; that would create a second, inconsistent FTS path. Decisions already index into `mem_fts` today via `recordDecision()`/`add("decision")`.

> Indexes that reference `migrate()`-added columns are NOT placed in `SCHEMA_SQL` (the file's own comment explains why: `SCHEMA_SQL` runs before `migrate()`). `project_facts` is created whole here so its own-column indexes are safe inline. The `decisions` new-column indexes go in `migrate()` (see 1b).

### 1b. `store.ts` `migrate()` additions (append to the `cols` array)

Add the seven new `decisions` columns the way the spec demands, all nullable/defaulted so the `ALTER` never fails on existing rows:

```ts
["decisions", "slug", "TEXT"],
["decisions", "status", "TEXT DEFAULT 'proposed'"],
["decisions", "scope", "TEXT DEFAULT '**'"],
["decisions", "invariant", "INTEGER NOT NULL DEFAULT 0"],
["decisions", "ttl_days", "INTEGER"],
["decisions", "source_path", "TEXT"],
["decisions", "tags", "TEXT"],
```

> `slug` is **NOT** `UNIQUE NOT NULL` (can't add a NOT NULL/UNIQUE column to a populated table via ALTER without a default + rebuild). Uniqueness is enforced at the write path (`getDecisionBySlug` before insert; upsert-by-slug in `compile-vault.ts`). Add a partial-style index in `migrate()`'s `indexes` array:

```ts
`CREATE INDEX IF NOT EXISTS idx_decisions_slug ON decisions(slug)`,
`CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`,
```

The `try/catch` swallow logic already in `migrate()` covers these verbatim — no new error handling needed.

### 1c. New thin read methods on `MemoryStore` (OWNED by `store.ts`)

These are the surface the read-only MCP wraps. All are SELECT-only; none write.

- `getDecisionBySlug(slug: string): DecisionRow | null` — `SELECT ... FROM decisions WHERE slug = ? AND status='accepted' ORDER BY id DESC LIMIT 1`. Returns full fields + computed `ageDays` (from `last_verified_at`) + `stale` (ageDays past `ttl_days ?? DEFAULT_STALE_AFTER_DAYS`).
- `getFact(key: string, scope?: string): FactRow | null` — most-specific-glob-wins. Fetch all `accepted` rows matching `key`, rank candidate `scope` globs by specificity (longer non-`**` glob that matches the querying scope wins), return best. Include `ageDays` + `stale`.
- `staleTruth(scope?: string): readonly StaleRow[]` — replaces the spec's `stale_truth` VIEW with a TS method (**[RECONCILED]** — no SQL view; reuses `last_verified_at`). Returns `accepted AND invariant=1` decisions + facts whose `ageDays > (ttl_days ?? DEFAULT_STALE_AFTER_DAYS)`, each as `{ kind: 'decision'|'fact', ref: 'decisions#id'|'project_facts#id', addressable: slug|key, ageDays, ttlDays }`. Optional `scope` filter via glob match.
- `searchGrounding(query, kind?, scope?, limit=8)` — calls the existing `mem_fts` BM25 path filtered to `source IN ('decisions','project_facts','errors_solutions')` per `kind`, then enriches each hit with `ageDays`/`stale` via a per-row meta lookup (reuse the private `fetchMeta` pattern; expose a small public helper if needed). This is the MCP's `memory_search` backend; it does NOT duplicate `recall()` scoring — it is the lighter `search()` shape the spec asks for (capped, scoped).
- `proposeDecision(input)` / `proposeFact(input)` — write helpers for the CLI append path (status `proposed`, `last_verified_at = now`, index into `mem_fts`). See §6. Distinct from the read methods; same file.

Add exported row interfaces (`DecisionRow`, `FactRow`, `StaleRow`, `GroundingHit`) to `store.ts` so `index.ts` re-exports them (it does `export * from "./store.js"`).

---

## 2. `packages/memory-mcp` — read-only stdio MCP (NEW package)

### File list
```
packages/memory-mcp/
├── src/
│   ├── index.ts      # stdio MCP server entry (bin); registers 4 tools; connects StdioServerTransport
│   ├── db.ts         # resolveDbPath() + openReadOnlyStore(): MemoryStore-backed read handle
│   └── queries.ts    # 4 tool handlers; each wraps ONE MemoryStore read method; formats { content:[{type:'text'...}] }
├── package.json
├── tsconfig.json
└── README.md
```

### `package.json` (copy `packages/memory` conventions; researched versions)
- `"name": "@claudemax/memory-mcp"`, `"version": "0.2.0"`, `"type": "module"`, `"private": false`, `publishConfig.access: public`.
- `"bin": { "claudemax-memory-mcp": "./dist/index.js" }` (binary entry — default export allowed only here per CLAUDE.md style rule).
- `"main"/"types"/"exports"` mirroring `packages/memory`.
- `scripts`: identical to `packages/memory` (`build: tsc -p tsconfig.json`, `dev`, `typecheck`, `test`).
- **dependencies:**
  - `"@modelcontextprotocol/sdk": "^1.29.0"` (stable v1.x; do NOT use v2.0.0-alpha — breaking error-handling changes per research)
  - `"@claudemax/memory": "workspace:*"` (wraps the existing store; do NOT re-open raw sqlite for reads beyond what the store exposes)
  - `"better-sqlite3": "^12.10.0"` (matches `packages/memory`; needed because the read handle opens `{ readonly: true }` — see db.ts)
  - `"zod": "^4.0.0"` (pin our own; SDK accepts v3.25+/v4 but do NOT rely on SDK-internal zod — research pitfall "w._parse is not a function")
- **devDependencies:** `@types/better-sqlite3 ^7.6.0`, `@types/node ^22.10.0`, `typescript ^5.7.0`, `vitest ^3.2.0`.

### `tsconfig.json`
Identical to `packages/memory/tsconfig.json`: `extends ../../tsconfig.base.json`, `outDir ./dist`, `rootDir ./src`, `include src/**/*`. Base already gives `module/moduleResolution: NodeNext` + `strict` — satisfies the SDK's ESM/Node16-class requirement (NodeNext is the superset). `.js` extensions on all relative imports (repo already does this).

### `src/db.ts` — read-only handle + path resolution
- `resolveDbPath(): string` — `process.env.CLAUDEMAX_DB` else `join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".claudemax", "memory.sqlite")`.
- **File-existence check BEFORE opening** (research pitfall: `fileMustExist` is ignored when `readonly:true`). If missing, the MCP still starts but every tool returns `{ isError: true, content:[{type:'text', text:'memory db not found at <path>; nothing grounded yet'}] }` — fail-soft, never crash.
- Open via `new Database(path, { readonly: true })`. **[RECONCILED]**: `MemoryStore`'s constructor does `mkdirSync` + `PRAGMA journal_mode=WAL` + `exec(SCHEMA_SQL)` + `migrate()` — all WRITES, which throw on a readonly handle. So the MCP does **NOT** instantiate `MemoryStore` directly. Instead `db.ts` opens the raw `better-sqlite3` readonly handle and `queries.ts` runs the SAME SELECT statements as the new `store.ts` read methods (1c). Keep the SQL text identical between `store.ts` and `queries.ts` (or, cleaner: extract the pure SELECT strings into `packages/memory/src/grounding-queries.ts` exported constants that BOTH `store.ts` and `memory-mcp/queries.ts` import — preferred, removes drift). The MCP imports the query strings + row-mapping helpers from `@claudemax/memory`; it never imports the writeable `MemoryStore` class for tool execution.

### `src/index.ts` — server + tools
- `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` and `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"` (ESM subpath imports with `.js`).
- **CRITICAL stdio discipline (research):** ONLY JSON-RPC on stdout. Every log/debug line → `console.error`. No `console.log` anywhere in the package. Code-review gate: grep the package for `console.log` must return empty.
- `server.registerTool(name, { title, description, inputSchema, outputSchema }, handler)`. `inputSchema` built with our pinned `zod`. Handlers are `async (args) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] })`; on any caught error return `{ isError: true, content: [...] }` — never throw (research: thrown handler errors become opaque JSON-RPC protocol errors).
- Wrap `transport`/`server.connect` so an EPIPE on client disconnect is caught and the process exits 0.

### The 4 tools (the whole surface — no `dump_all`, per spec §9)

| MCP tool | Args (zod) | Wraps (`store.ts`/`grounding-queries`) | Returns |
|----------|-----------|----------------------------------------|---------|
| `memory_search` | `query: string`, `kind?: 'decision'\|'fact'\|'fix'\|'all'` (default `all`), `scope?: string`, `limit?: number` (default 8, max 25) | `searchGrounding()` | ranked `mem_fts` BM25 hits across `decisions` + `project_facts` + `errors_solutions`, each `{ ref, title, snippet, ageDays, stale }` |
| `memory_get_decision` | `slug: string` | `getDecisionBySlug()` | one accepted decision, full fields + `stale: boolean` |
| `memory_get_fact` | `key: string`, `scope?: string` | `getFact()` | best fact for scope (most-specific glob wins) + `stale` |
| `memory_stale` | `scope?: string` | `staleTruth()` | `invariant=1 accepted` rows past TTL → `[{ kind, ref, addressable, ageDays, ttlDays }]` |

Surfaced tool names (research): `mcp__memory__memory_search`, `mcp__memory__memory_get_decision`, `mcp__memory__memory_get_fact`, `mcp__memory__memory_stale`. Tool **descriptions** carry: what is retrieved, params+types, the cap, and "results carry `ageDays`/`stale` — treat stale rows as assumptions" (research: descriptions are the primary LLM-failure point).

### Workspace wiring
- `pnpm-workspace.yaml` already globs `packages/*` → no edit needed; the new dir is auto-included. (`allowBuilds: better-sqlite3: true` already present — the new package's native dep builds.)
- Root `package.json` `build/typecheck/test` already use `pnpm -r --filter=./packages/*` → the new package is picked up automatically. No root-script edit needed.

---

## 3. `packages/grounding` — schema migrate + compile scripts (NEW package)

### File list
```
packages/grounding/
├── src/
│   ├── index.ts            # re-exports the 4 below for programmatic use
│   ├── migrate.ts          # opens MemoryStore(path) → triggers SCHEMA_SQL+migrate() (idempotent), prints what landed
│   ├── frontmatter.ts      # parse/serialize YAML-ish frontmatter (NO new dep — tiny hand-rolled parser, see below)
│   ├── compile-vault.ts    # vault/*.md (blessed:true) → sqlite accepted rows (upsert by slug / (key,scope))
│   ├── export-vault.ts     # sqlite proposed rows w/o source_path → vault/_inbox/*.md (blessed:false)
│   └── compile-claudemd.ts # sqlite accepted+invariant=1 → CLAUDE.md managed block (scoped)
├── package.json
├── tsconfig.json
└── README.md
```

### `package.json`
- `"name": "@claudemax/grounding"`, deps: `"@claudemax/memory": "workspace:*"` (it uses the writeable `MemoryStore` — these scripts WRITE). No YAML dep: frontmatter is a constrained shape (flat key/value + simple `[a, b]` arrays + booleans), so `frontmatter.ts` hand-rolls a 40-line parser/serializer (keeps the lean-dependency posture; matches how the repo avoids heavy deps). Same `scripts`/`tsconfig` conventions as `packages/memory`.

### `migrate.ts` responsibility
`new MemoryStore({ path: resolveDbPath() })` → constructor runs `SCHEMA_SQL` (creates `project_facts`) + `migrate()` (adds `decisions` columns) idempotently → close. Print a diff of which columns/tables now exist (`PRAGMA table_info`). Idempotent: safe to run every time. Wired as `cmax ground migrate` (and called implicitly by `compile`).

### `frontmatter.ts` shape (the vault note contract)
```yaml
---
kind: decision            # 'decision' | 'fact'
slug: anthropic-only       # decisions only — stable address
key: db.migrations.tool    # facts only — addressable key
title: ...                 # decisions: short title (stored in decisions.topic)
value: ...                 # facts only — the fact body (stored in project_facts.value)
decision: ...              # decisions only — what we decided (decisions.decision)
rationale: ...             # decisions only (decisions.rationale)
status: accepted
blessed: true              # THE GATE. unset/false → ignored by compile-vault
invariant: true            # → promote into CLAUDE.md managed block
scope: '**'                # path glob
ttl_days: 180              # optional staleness-window override
confidence: 5              # facts only, 1..5
tags: [anthropic, hard-rule]
supersedes: some-old-slug  # decisions only — marks prior row superseded
source: CLAUDE.md          # facts only — provenance
---
<markdown body — for decisions, the long-form rationale/alternatives/consequences>
```

**[RECONCILED] frontmatter→column mapping** (the existing `decisions` table has `topic/decision/rationale`, not `title`):
- decision note: `topic ← title`, `decision ← decision` (or body if absent), `rationale ← rationale`, plus new cols `slug, status, scope, invariant, ttl_days, source_path(=note path), tags`.
- fact note: `key, value, scope, status, invariant, confidence, source, source_path, tags, ttl_days`.
- On compile, set `last_verified_at = today` (compute fresh — never cache; this is what staleness reads). `verified_count` set to `1` on accept (matches `add()` semantics).

### `compile-vault.ts` (Obsidian → sqlite, promote blessed)
Walk `vault/decisions/*.md` + `vault/facts/*.md`. Parse frontmatter. Only `blessed: true` notes upsert as `status='accepted'`:
- decisions: upsert by `slug` (use `getDecisionBySlug`; UPDATE if found else INSERT; index into `mem_fts`). If `supersedes` set, `UPDATE decisions SET status='superseded', superseded_by=<new id> WHERE slug=<old>`.
- facts: upsert by `(key, scope)` (the `UNIQUE` constraint) via `INSERT ... ON CONFLICT(key,scope) DO UPDATE`.
- set `source_path` to the note path (round-trip), `last_verified_at = today`.
Wired as part of `cmax ground compile`.

### `export-vault.ts` (sqlite → vault/_inbox, review queue)
Select `status='proposed'` rows with `source_path IS NULL` (i.e. agent-appended, never blessed). Write each to `vault/_inbox/<slug-or-key>.md` with frontmatter `blessed: false`. Never auto-bless. This is the human-in-the-loop surface. Wired as `cmax ground export`.

### `compile-claudemd.ts` (sqlite → CLAUDE.md managed block)
Select `status='accepted' AND invariant=1`, group by `scope`. For each scope, locate the target `CLAUDE.md` (root scope `**` → repo-root `CLAUDE.md`; `packages/x/**` → `packages/x/CLAUDE.md`, create if missing). Replace the fenced managed block:

```
<!-- GROUNDING:BEGIN (generated YYYY-MM-DD — do not edit by hand) -->
## Project invariants (compiled from memory.sqlite)

- **<decision.topic>.** (decision: <slug> · verified <last_verified_at-date>)
- **<fact.value>.** (fact: <key> · verified <last_verified_at-date>)
<!-- GROUNDING:END -->
```

Idempotent: regex-replace between markers, leave hand-written prose untouched. The `generated YYYY-MM-DD` date is what `freshness-gate.sh` reads (§5). Part of `cmax ground compile`.

> **Root `CLAUDE.md` caution:** the repo root `CLAUDE.md` is large and hand-curated. `compile-claudemd.ts` only ever touches text BETWEEN the markers; if no markers exist it APPENDS a fresh block at EOF (never rewrites existing content). The seed step (§8) introduces the markers once.

---

## 4. `cmax memory propose-*` + `cmax ground compile|export` (OWNED by `packages/cli`)

### `commands/memory.ts` — add two subcommands (thin wrappers over the append path)
Follow the exact shape of the existing `add`/`verify` subcommands (commander, `--path` default `.claudemax/memory.sqlite`, `resolve(process.cwd(), opts.path)`, `MemoryStore`, `m.close()`, kleur output):

```
cmax memory propose-decision --slug <s> --title <t> --decision <d> [--rationale <r>] [--scope <glob>] [--invariant] [--tags <csv>]
cmax memory propose-fact      --key <k> --value <v> [--scope <glob>] [--confidence <1-5>] [--invariant] [--tags <csv>] [--source <s>]
```
Both call new `MemoryStore.proposeDecision()` / `proposeFact()` (1c) which INSERT with `status='proposed'`, `last_verified_at = now`, index into `mem_fts`, and print `proposed → decisions#<id>` / `project_facts#<id>`. These are what the grounded-worker spawn prompt tells agents to use (§7).

### NEW `commands/ground.ts` — `cmax ground <migrate|compile|export>`
- `cmax ground migrate` → `@claudemax/grounding` `migrate()`.
- `cmax ground compile` → `compile-vault()` then `compile-claudemd()` (vault → sqlite → CLAUDE.md, in order).
- `cmax ground export` → `export-vault()` (proposed rows → `vault/_inbox/`).
- `--path` option, default `.claudemax/memory.sqlite`, same resolve pattern.
- Register in `packages/cli/src/index.ts`: `import { groundCommand } from "./commands/ground.js";` + `program.addCommand(groundCommand());`. `@claudemax/grounding` is added to `packages/cli/package.json` dependencies as `workspace:*`.

---

## 5. `.claude/hooks/freshness-gate.sh` + `settings.json` (OWNED by `.claude/`)

### Behavior (bash + python3 floor, like the vendored `time-anchor.sh`)
- `set -euo pipefail`. Resolve `DB="${CLAUDEMAX_DB:-${CLAUDE_PROJECT_DIR:-$PWD}/.claudemax/memory.sqlite}"`. If `[ ! -f "$DB" ]` → `echo '{}'; exit 0` (fail-open).
- Open sqlite **read-only** in python (`sqlite3.connect(f"file:{db}?mode=ro", uri=True)`), wrapped in try/except → on ANY exception `print('{}')` and exit 0.
- **Check 1 — stale ground truth:** query `decisions` + `project_facts` for `status='accepted' AND invariant=1` where `julianday('now') - julianday(last_verified_at) > COALESCE(ttl_days, 30)`. (**[RECONCILED]** — uses `last_verified_at`, not a `stale_truth` view.) If any, build the additionalContext line: `"N ground-truth items past verify-by: decisions#id (Xd/Yd), ...; treat as assumptions and re-verify before relying on them."`
- **Check 2 — compile freshness:** read the `GROUNDING:BEGIN (generated YYYY-MM-DD ...)` date from root `CLAUDE.md`; if older than 14 days OR older than the newest `accepted` row's `last_verified_at`, append `"CLAUDE.md invariants block is stale vs memory.sqlite — run cmax ground compile."`
- Emit `{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<joined msgs>"}}` — **must include `hookEventName`** (research: mandatory or Claude Code rejects it). The event name is read from the input JSON's `hook_event_name` field (so the same script serves SessionStart and SubagentStop). Cap `additionalContext` at <10k chars (research truncation limit). If no messages, `print('{}')`.
- **SubagentStop is observability-only** (research): `additionalContext` is silently ignored there. We still register it for symmetry + logging, but the load-bearing injection is on **SessionStart**. The script emits the same JSON; on SubagentStop Claude Code ignores the context (harmless).
- Never `exit 2`, never block. All Python output buffered; only the final `print(json.dumps(...))` writes stdout; debug → `sys.stderr`.

### `settings.json` edits (the file is OWNED by this step)
Add `freshness-gate.sh` to the existing `SessionStart` matcher block (alongside `cmax-session-start.sh`) and to the `SubagentStop` block, referenced **directly** (not via `dp.sh`):

- In `hooks.SessionStart[0].hooks` append: `{ "type": "command", "command": ".claude/hooks/freshness-gate.sh", "timeout": 5 }`
- In `hooks.SubagentStop[0].hooks` append: `{ "type": "command", "command": ".claude/hooks/freshness-gate.sh", "timeout": 5 }`

**[RECONCILED] MCP registration does NOT go in `settings.json`** (research: settings.json holds no `mcpServers`). It goes in `.mcp.json` — see §6 below. `settings.json` in this step only gains the two hook lines. Mark `freshness-gate.sh` executable (`chmod +x`).

---

## 6. `.mcp.json` at repo root (NEW file — Claude Code + SDK registration)

**[RECONCILED]** This replaces the spec's `settings.json.mcpServers` block. Committed to git (project scope, team-shared). The Agent SDK inherits it because `baseSdkOptions()` sets `settingSources: ["user","project"]`.

```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR}/packages/memory-mcp/dist/index.js"],
      "env": { "CLAUDEMAX_DB": "${CLAUDE_PROJECT_DIR:-.}/.claudemax/memory.sqlite" }
    }
  }
}
```
- `${VAR:-default}` expansion is supported in `.mcp.json` (research). Use absolute-via-`CLAUDE_PROJECT_DIR` for the dist path (relative paths break between Claude Code cwd and SDK cwd — research pitfall).
- Project-scope servers need one-time approval in Claude Code (`claude mcp list` shows pending). Document this in the build doc; it's a human step, not code.
- Update `docs/MCP_SERVERS.md`: note that the first-party `memory` server is pre-registered in `.mcp.json` (not settings.json) and is the one exception to "claudemax does not bundle MCP servers."

---

## 7. `.claude/agents/grounded-worker.md` + runtime spawn wiring

### `.claude/agents/grounded-worker.md` (NEW — `.claude/agents/` dir does not yet exist; create it)
Agent-definition frontmatter + the §8 contract from the spec, adjusted to repo tool names:
```markdown
---
name: grounded-worker
description: Default worker for claudemax sub-Spec leaves. Grounds against memory before inventing.
tools: [Read, Edit, Bash, Grep, Glob, mcp__memory__memory_search, mcp__memory__memory_get_decision, mcp__memory__memory_get_fact, mcp__memory__memory_stale, WebSearch, WebFetch]
---
<the 5-point contract: execute one leaf verbatim; query memory before asserting a fact;
unknown facts are ASSUMPTIONS (label explicitly); re-verify memory_stale hits; propose via
`cmax memory propose-*` (lands proposed, never self-bless); return one clean summary, pull only what the leaf needs>
```
This dovetails with the existing `no-vibes`/`no-fake-recall`/`no-fake-cite` dark-patterns hooks (states the rule; hooks enforce it; freshness-gate dates it).

### Where the contract gets prepended (runtime)
There are THREE spawn surfaces; each gets the grounding contract + the `mcpServers`/`allowedTools` for Mode A determinism. **[RECONCILED]** Add one exported constant `GROUNDED_WORKER_CONTRACT` to `packages/runtime/src/prompts.ts` (next to `MEMORY_TOOL_RULE`), then:

1. **`orchestrator.ts` (Mode A SDK subagents)** — in `runPacket()`, the `query()` options:
   - append `GROUNDED_WORKER_CONTRACT` to `PACKET_AGENT_SYSTEM(...)` (the `systemPrompt.append` string).
   - add `mcpServers: { memory: { type: "stdio", command: "node", args: [<abs path to memory-mcp/dist/index.js>], env: { CLAUDEMAX_DB: <resolved> } } }` to the options object.
   - add `mcp__memory__*` to `allowedTools` (currently `[...decision.tools]`).
   The options object is already cast `as never`, so the new keys need no type gymnastics.

2. **`goal.ts` (`runGoal` Mode A driver)** — same three edits on its `query()` call: append `GROUNDED_WORKER_CONTRACT` to `GOAL_DRIVER_SYSTEM(spec)`, add `mcpServers.memory`, add `mcp__memory__*` to its explicit `allowedTools` array.

3. **`agent-teams.ts` (Mode B teammates)** — these spawn `claude -p <prompt> --dangerously-skip-permissions` as a subprocess. The MCP comes from `.mcp.json` automatically (Claude Code reads it). The contract is injected by prepending `GROUNDED_WORKER_CONTRACT` into the `prompt` array in `spawnTeammate()`. (No `mcpServers` option needed here — the subprocess inherits `.mcp.json`.)

> Helper: add `memoryMcpServerConfig(cwd)` to `sdk-options.ts` returning the `{ memory: {...} }` block with the dist path resolved via `fileURLToPath(import.meta.url)` relative to the runtime dist (same technique `orchestrator-multi.ts` uses for `CLI_BIN`). Both `orchestrator.ts` and `goal.ts` import it → single source of truth for the path, no drift. `allowedTools` gets `mcp__memory__*` appended at each call site.

---

## 8. `vault/` scaffold + seed blessed notes (NEW — committed to git)

```
vault/
├── decisions/
│   ├── anthropic-only.md
│   ├── opus-for-verify-spec-architect.md
│   └── multispec-default.md
├── facts/
│   ├── auth-subscription-first.md
│   └── parallelism-two-modes.md
├── _inbox/        # .gitkeep — export-vault.ts target for proposed rows
└── _moc/          # .gitkeep — human maps-of-content (optional)
```

Seed notes (all `blessed: true`, real claudemax invariants drawn from `CLAUDE.md`):

1. **`decisions/anthropic-only.md`** — slug `anthropic-only`, invariant `true`, scope `**`. Decision: "All provider calls route through `query()` from `@anthropic-ai/claude-agent-sdk`; the bare `@anthropic-ai/sdk` is not a dependency and must not be reintroduced. Anthropic-only by design." (CLAUDE.md working rule 1 + subscription-first auth.)
2. **`decisions/opus-for-verify-spec-architect.md`** — slug `opus-for-verify-spec-architect`, invariant `true`, scope `**`. Decision: "/verify, /spec, /architect always run on Opus; never demoted, even with --cheap or past 70/90/95% credit." (CLAUDE.md rule 4.)
3. **`decisions/multispec-default.md`** — slug `multispec-default`, invariant `true`, scope `**`. Decision: "Multispec is the default; every umbrella auto-runs deepresearch + multispec + parallel /goal + verify. No --multi flag." (CLAUDE.md rule 5.)
4. **`facts/auth-subscription-first.md`** — key `auth.provider.sdk`, value "subscription-first via `@anthropic-ai/claude-agent-sdk` `query()`; structured output via `outputFormat:{type:'json_schema',schema}`", invariant `true`, scope `**`, confidence 5, source `CLAUDE.md`.
5. **`facts/parallelism-two-modes.md`** — key `parallelism.modes`, value "Mode A = SDK subagents in one query() (small/short); Mode B = Claude Code Agent Teams (big multi-day swarms); auto-selected, override --mode {auto|solo|teams}", invariant `true`, scope `**`, confidence 5, source `CLAUDE.md`.

Seed flow: write notes → `cmax ground migrate` → `cmax ground compile` → confirm `GROUNDING:BEGIN` block lands in root `CLAUDE.md` with these 5 invariants.

---

## 9. Docs / CHANGELOG / CLAUDE.md updates

- **`docs/GROUNDING_LAYER.md`** (NEW, distinct from this plan) — user-facing architecture doc: the four tiers, the write-once/read-many rule, the compile loop, how Mode A/B ground identically. (Or fold into existing `docs/ARCHITECTURE.md` — implementer's choice; this plan + the spec are the source.)
- **`docs/MCP_SERVERS.md`** — add the first-party `memory` server in `.mcp.json` (the bundled exception).
- **`CHANGELOG.md`** — `0.2.x` entry: grounding layer (memory-mcp read-only MCP, grounding compile package, freshness-gate hook, grounded-worker agent, vault, `cmax memory propose-*`, `cmax ground compile|export`).
- **`CLAUDE.md`** (root) — (a) gains the `GROUNDING:BEGIN`/`END` managed block (via seed compile); (b) Repository-shape section: add `packages/memory-mcp` and `packages/grounding` to the monorepo list; (c) one working rule: "Grounding: agents propose (`status=proposed`), humans bless in vault, `cmax ground compile` promotes → accepted + CLAUDE.md block. Agents never self-bless. MCP is read-only."
- **memory entry** — `feedback-grounding-layer.md` in the memory dir (machine-proposes/human-blesses/compile-promotes is the durable invariant).

---

## 10. Build order (foundation → packages → integrate → verify) — strict file ownership

No two steps edit the same file. Each step OWNS its files exclusively.

**Step 1 — Schema foundation.** OWNS: `packages/memory/src/schema.ts`, `packages/memory/src/store.ts`.
Add `project_facts` to `SCHEMA_SQL`; add 7 `decisions` columns + 2 indexes to `migrate()`; add read methods (`getDecisionBySlug`, `getFact`, `staleTruth`, `searchGrounding`) + write helpers (`proposeDecision`, `proposeFact`) + row interfaces; (preferred) add `packages/memory/src/grounding-queries.ts` with shared SELECT constants and re-export from `index.ts`. `pnpm --filter @claudemax/memory typecheck && test`.

**Step 2 — Grounding package.** OWNS: all of `packages/grounding/`. Depends on Step 1's store API. `migrate.ts`, `frontmatter.ts`, `compile-vault.ts`, `export-vault.ts`, `compile-claudemd.ts`, `index.ts`, `package.json`, `tsconfig.json`, `README.md`. `pnpm build && typecheck`.

**Step 3 — MCP package.** OWNS: all of `packages/memory-mcp/`. Depends on Step 1 (imports query strings/row mappers from `@claudemax/memory`). `index.ts`, `db.ts`, `queries.ts`, `package.json`, `tsconfig.json`, `README.md`. `pnpm build`; smoke: `echo '{"jsonrpc":"2.0",...}' | node dist/index.js` lists 4 tools; grep package for `console.log` → empty.

**Step 4 — CLI surface.** OWNS: `packages/cli/src/commands/memory.ts` (add `propose-decision`/`propose-fact`), `packages/cli/src/commands/ground.ts` (NEW), `packages/cli/src/index.ts` (register `groundCommand`), `packages/cli/package.json` (add `@claudemax/grounding` dep). Depends on Steps 1+2. `pnpm build`; `cmax ground migrate` runs clean.

**Step 5 — Hook + agent + MCP config.** OWNS: `.claude/hooks/freshness-gate.sh` (NEW), `.claude/settings.json` (append 2 hook lines only), `.claude/agents/grounded-worker.md` (NEW), `.mcp.json` (NEW). Independent of runtime code. Verify hook emits valid JSON on a DB with a stale row; verify `.mcp.json` parses.

**Step 6 — Runtime integration.** OWNS: `packages/runtime/src/prompts.ts` (add `GROUNDED_WORKER_CONTRACT`), `packages/runtime/src/sdk-options.ts` (add `memoryMcpServerConfig`), `packages/runtime/src/orchestrator.ts` (mcpServers + allowedTools + contract), `packages/runtime/src/goal.ts` (same), `packages/runtime/src/agent-teams.ts` (prepend contract to teammate prompt). Depends on Step 3 (MCP dist exists). `pnpm -r build && typecheck && test`.

**Step 7 — Seed + smoke.** OWNS: `vault/**` (5 notes + `.gitkeep`s), and EXECUTES (does not author conflicting edits to) `cmax ground migrate` + `cmax ground compile` → writes the `GROUNDING:BEGIN` block into root `CLAUDE.md`. **[Ownership note]** The `CLAUDE.md` managed block is WRITTEN BY THE COMPILE TOOL at this step, not hand-edited in any earlier step — so root `CLAUDE.md` has exactly one writer (Step 7 via the tool). Docs/CHANGELOG hand-edits (§9) are also Step 7-owned to avoid `CLAUDE.md` contention.

**Step 8 — Verify (blind Opus `/verify`).** Re-read the repo blind; check: `project_facts` exists + `decisions` has new columns (`PRAGMA table_info`); MCP lists 4 tools over a readonly handle; `freshness-gate.sh` fail-opens on a missing DB and injects on a stale row; a Mode A goal run and a Mode B teammate both resolve the same fact via `mcp__memory__memory_get_fact`; `cmax ground compile` is idempotent (run twice → identical CLAUDE.md block).

---

## 11. Open risks

1. **`.mcp.json` vs rule 9 (`settings.json`).** SOTA is firm that settings.json holds no `mcpServers`; we used `.mcp.json` + inline SDK `mcpServers`. If the user truly wants the literal settings.json key, it would be a non-functional placeholder. Flagged for human confirmation.
2. **Readonly handle cannot run `MemoryStore` constructor** (it writes: mkdir + WAL pragma + SCHEMA_SQL + migrate). Mitigation: MCP opens a raw `better-sqlite3 {readonly:true}` handle and runs the SAME SELECTs (shared `grounding-queries.ts` constants). If those constants drift from `store.ts`, the MCP and CLI disagree — the shared-constants approach is the guard; a test asserting both import the same string is recommended.
3. **`mem_fts` is one shared table, not per-table FTS.** We deliberately did NOT build the spec's `decisions_fts`/`project_facts_fts` + triggers. Risk: `searchGrounding` filtering by `source` must exactly match the `indexFts(source,...)` string used at write time (`'decisions'`, `'project_facts'`, `'errors_solutions'`). A wrong source string silently returns no hits.
4. **Project-scope MCP approval gate.** Claude Code requires one-time approval of `.mcp.json` servers (`claude mcp list`); until approved, Mode B teammates won't see `mcp__memory__*`. Mode A (inline `mcpServers`) sidesteps this. Document the approval step in onboarding.
5. **FTS5 MATCH injection via free-text `query`.** `searchGrounding` must route through the existing `sanitizeFtsQuery()` (already in `store.ts`) — do NOT pass raw MCP `query` arg into `MATCH`. Reuse, don't reinvent.
6. **`slug` not UNIQUE at the DB level** (ALTER can't add UNIQUE to a populated table cleanly). Uniqueness enforced only in TS (`getDecisionBySlug` pre-check + upsert). A direct `cmax memory add decision` (legacy path) won't set a slug, so it won't collide — but two `propose-decision --slug X` calls could create duplicate slugs as `proposed`; compile-vault upserts by slug so accepted rows stay unique, but the proposed queue may have dupes. Acceptable (human dedupes at bless time); flagged.
7. **Root `CLAUDE.md` edit contention.** Mitigated by making the managed block tool-written and confining all `CLAUDE.md` hand-edits to Step 7. If an implementer hand-edits `CLAUDE.md` in an earlier step, the ownership guarantee breaks.
8. **`@modelcontextprotocol/sdk` subpath import names** (`/server/mcp.js`, `/server/stdio.js`) are pinned to v1.29.0; a minor bump could move them. Pin `^1.29.0` and avoid v2-alpha (breaking error-handling per research).
9. **better-sqlite3 native rebuild** for the new `memory-mcp` package must succeed under pnpm (`allowBuilds: better-sqlite3: true` is set; the package must be in the workspace glob — it is).
