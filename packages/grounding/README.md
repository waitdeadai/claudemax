# @claudemax/grounding

Compile scripts for the claudemax grounding layer. Promotes blessed Obsidian
vault notes into `.claudemax/memory.sqlite` and compiles the `invariant=1`
accepted rows into per-scope `CLAUDE.md` managed blocks.

The schema itself is owned by `@claudemax/memory` (the `decisions` table gained
grounding columns; `project_facts` is a new table). This package only *drives*
that store — it never redefines the DDL.

## The flow

```
machine proposes  →  human blesses  →  compile promotes
```

- Agents append `status='proposed'` rows via `cmax memory propose-*`.
- You review in the vault (markdown in git) and set `blessed: true`.
- `cmax ground compile` promotes blessed notes → `status='accepted'` rows →
  the `CLAUDE.md` managed block.

## API

- `migrate(dbPath?)` — instantiate `MemoryStore` (runs `SCHEMA_SQL` + `migrate()`
  idempotently), then read back `PRAGMA table_info` to confirm what landed.
- `compileVault(opts?)` — walk `vault/decisions/*.md` + `vault/facts/*.md`, parse
  frontmatter, upsert only `blessed:true` notes as `status='accepted'`
  (decisions by `slug`, facts by `(key, scope)`), set `source_path`, handle
  `supersedes`.
- `exportVault(opts?)` (also exported as `export`) — write `proposed` rows with no
  `source_path` into `vault/_inbox/` as `blessed:false` notes (the review queue).
- `compileClaudeMd(opts?)` — write/replace the fenced
  `<!-- GROUNDING:BEGIN ... -->` … `<!-- GROUNDING:END -->` managed block in each
  scope's `CLAUDE.md`. Idempotent; never touches prose outside the markers.
- `compile(opts?)` — `compileVault` then `compileClaudeMd`, in that order
  (`cmax ground compile`).

## DB path resolution

`CLAUDEMAX_DB` env wins; otherwise `.claudemax/memory.sqlite` under
`CLAUDE_PROJECT_DIR` (or the current working directory). The DB and `.claudemax/`
are gitignored — only the `vault/` markdown and this code are committed.

## Frontmatter contract

`frontmatter.ts` is a constrained hand-rolled parser (no new dependency): flat
key/value, quoted/unquoted scalars, booleans, integers, and inline `[a, b]`
arrays. Nested maps and block scalars are unsupported by design — the vault note
contract never uses them.
