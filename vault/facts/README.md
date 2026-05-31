# facts/ — small addressable truths (one per file)

One project fact per markdown file, addressed by a `key`. Compiled into the
`project_facts` table of `.claudemax/memory.sqlite` by `cmax ground compile` when
`blessed: true`. Upsert key is `(key, scope)`.

Frontmatter → column mapping:

| Frontmatter | sqlite column |
|-------------|---------------|
| `key` | `key` (addressable, e.g. `db.migrations.tool`) |
| `value` | `value` (the fact body) |
| `scope` | `scope` (path glob; most-specific glob wins at read time) |
| `status` | `status` (set to `accepted` on compile of a blessed note) |
| `invariant` | `invariant` (1 → promoted into the CLAUDE.md block) |
| `confidence` | `confidence` (1–5) |
| `source` | `source` (provenance: URL / commit / note) |
| `ttl_days` | `ttl_days` (optional staleness-window override) |
| `tags` | `tags` |
| (note path) | `source_path` (round-trip) |
| (compile time) | `last_verified_at` = today |

Most-specific scope wins: a fact scoped `packages/auth/**` overrides one scoped
`**` for a leaf inside `packages/auth`. Edit the note and recompile — never
hand-edit the sqlite rows.
