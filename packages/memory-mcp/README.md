# @claudemax/memory-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io) stdio server over the
claudemax `memory.sqlite` store. It gives a freshly-spawned subagent — Mode A SDK subagents
and Mode B Agent Teams alike — a deterministic, dated, addressable source of truth without
re-feeding it by hand and without polluting its clean context.

It is the **read** half of the grounding layer's "machine proposes → human blesses → compile
promotes" rule. Writes never go through this server: agents append `proposed` rows via
`cmax memory propose-*`, humans bless in the vault, and `cmax ground compile` promotes them to
`accepted`. The MCP only ever surfaces `accepted` rows.

## Tools (the whole surface — no `dump_all`)

| Tool | Args | Returns |
|------|------|---------|
| `memory_search` | `query`, `kind?` (`decision`/`fact`/`fix`/`all`), `scope?`, `limit?` (1-25, default 8) | ranked FTS hits across `decisions` + `project_facts` + `errors_solutions`, each with `ageDays` + `stale` |
| `memory_get_decision` | `slug` | one accepted decision, full fields + `ageDays` + `stale` |
| `memory_get_fact` | `key`, `scope?` | best fact for the scope (most-specific glob wins) + `ageDays` + `stale` |
| `memory_stale` | `scope?` | accepted invariant rows past TTL: `[{ kind, ref, addressable, ageDays, ttlDays }]` |

Every result carries `ageDays` and a `stale` boolean. **Age is part of the truth** — treat a
stale row as an assumption and re-verify before relying on it.

## Read-only by design

The server opens a raw `better-sqlite3` handle with `{ readonly: true }`. It does **not**
instantiate the writeable `MemoryStore` (whose constructor runs `mkdir` + WAL pragma +
`exec(SCHEMA)` + `migrate()`, all writes that would throw on a readonly handle). The shared
SELECT constants and row mappers come from `@claudemax/memory` so the MCP and the CLI cannot
drift on the SQL they run against the same database.

## Database resolution

`CLAUDEMAX_DB` if set, otherwise `${CLAUDE_PROJECT_DIR:-$PWD}/.claudemax/memory.sqlite`. The
file is checked before opening (better-sqlite3 ignores `fileMustExist` when `readonly:true`); a
missing database is non-fatal — the server still starts and each tool returns a soft error.

## Running

```bash
pnpm --filter @claudemax/memory-mcp build
node packages/memory-mcp/dist/index.js   # stdio JSON-RPC
```

stdout is reserved for JSON-RPC; all diagnostics go to stderr. Registration lives in the
repo-root `.mcp.json` (Claude Code / Mode B) and inline in the Agent SDK `query()` calls
(Mode A).
