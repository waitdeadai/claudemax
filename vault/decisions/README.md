# decisions/ — ADRs (one per file)

One architectural decision per markdown file, addressed by a stable `slug`.
Compiled into the `decisions` table of `.claudemax/memory.sqlite` by
`cmax ground compile` when `blessed: true`.

Frontmatter → column mapping (the existing `decisions` table uses
`topic`/`decision`/`rationale`, not `title`):

| Frontmatter | sqlite column |
|-------------|---------------|
| `slug` | `slug` (stable address; upsert key) |
| `title` | `topic` |
| `decision` | `decision` (falls back to body if absent) |
| `rationale` | `rationale` |
| `status` | `status` (set to `accepted` on compile of a blessed note) |
| `scope` | `scope` (path glob; `**` = repo-wide) |
| `invariant` | `invariant` (1 → promoted into the CLAUDE.md block) |
| `ttl_days` | `ttl_days` (optional staleness-window override) |
| `tags` | `tags` |
| `supersedes` | marks the prior slug `status='superseded'` |
| (note path) | `source_path` (round-trip) |
| (compile time) | `last_verified_at` = today |

`slug` must be unique among accepted decisions; `compile-vault.ts` upserts by it.
Do not hand-edit the compiled sqlite rows — edit the note and recompile.
